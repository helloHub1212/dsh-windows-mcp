/**
 * Live desktop probes for `windows_mcp_doctor`.
 *
 * The configuration checks in `lib/index.js` cannot see the failure this module
 * exists for: upstream Windows-MCP can report every tool call as successful
 * while its UI Automation state is empty, so `Snapshot` prints "No windows
 * found" and `Move`/`Click` do nothing. The only honest way to separate that
 * from an installation problem is to measure the session directly:
 *
 * - how many top-level windows UI Automation can enumerate (the empty list is
 *   the known symptom of upstream CursorTouch/Windows-MCP#607), and
 * - the display scale, because the same upstream issue divides absolute
 *   coordinates by it on high-DPI setups.
 *
 * Everything here is read-only, best effort and bounded: a fixed PowerShell
 * script, no interpolation, a hard timeout, and a probe that resolves to an
 * error description instead of throwing. A host without PowerShell simply gets
 * "not measured".
 *
 * @module
 */

import { spawn } from "node:child_process";

/** Upstream report the probes point at when they see its signature. */
export const UPSTREAM_UIA_ISSUE = "https://github.com/CursorTouch/Windows-MCP/issues/607";

/** Default wall-clock budget for one probe run. */
export const PROBE_TIMEOUT_MS = 6000;

/**
 * Fixed probe program. Kept ASCII-only so the Windows console code page cannot
 * corrupt the JSON line; every measurement is independently guarded, and a
 * `-1` means "not measurable here" rather than a value.
 */
const PROBE_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$uia = -1",
  "try { Add-Type -AssemblyName UIAutomationClient | Out-Null; $root = [System.Windows.Automation.AutomationElement]::RootElement; $uia = @($root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)).Count } catch { $uia = -1 }",
  "$win = -1",
  "try { $win = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }).Count } catch { $win = -1 }",
  "$scale = -1",
  "try { Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DshDpiProbe { [DllImport(\"user32.dll\")] public static extern uint GetDpiForSystem(); }' | Out-Null; $scale = [math]::Round([DshDpiProbe]::GetDpiForSystem() / 96.0, 3) } catch { $scale = -1 }",
  "Write-Output ('{\"uia\":' + $uia + ',\"windows\":' + $win + ',\"scale\":' + $scale + '}')",
].join("; ");

/** Largest stdout slice a probe will keep; the real answer is one short line. */
const MAX_PROBE_OUTPUT = 16 * 1024;

/**
 * Read the last JSON object a probe run printed.
 *
 * PowerShell may prepend warnings or type-loading chatter, so scanning from the
 * end is deliberate state, not laziness.
 *
 * @param text - raw stdout.
 * @returns the parsed measurements, or null when no line is usable.
 */
export function parseProbeOutput(text) {
  if (typeof text !== "string" || text === "") return null;
  const lines = text.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith("{")) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object") continue;
    const uia = Number(parsed.uia);
    const windows = Number(parsed.windows);
    const scale = Number(parsed.scale);
    if (!Number.isInteger(uia) || !Number.isInteger(windows) || !Number.isFinite(scale)) continue;
    return {
      uiaWindows: uia >= 0 ? uia : null,
      windowHandles: windows >= 0 ? windows : null,
      displayScale: scale > 0 ? scale : null,
    };
  }
  return null;
}

/**
 * Turn one probe outcome into the report line and the upstream notes it
 * justifies. Pure, so the wording is testable without a desktop.
 *
 * @param probe - measurement, `{ error }`, or `{ skipped }`; null means no probe.
 * @returns the `desktop probe` line and zero or more upstream notes.
 */
export function describeProbe(probe) {
  if (probe === null || probe === undefined) {
    return { line: "not measured", notes: [] };
  }
  if (typeof probe.error === "string") {
    return { line: `not measured (${probe.error})`, notes: [] };
  }
  if (typeof probe.skipped === "string") {
    return { line: `not measured (${probe.skipped})`, notes: [] };
  }

  const uia = probe.uiaWindows;
  const handles = probe.windowHandles;
  const scale = probe.displayScale;
  const parts = [];
  parts.push(uia === null || uia === undefined ? "UI Automation unavailable" : `UI Automation sees ${uia} top-level window(s)`);
  if (handles !== null && handles !== undefined) parts.push(`${handles} window handle(s)`);
  if (scale !== null && scale !== undefined) parts.push(`display scale ${Math.round(scale * 100)}%`);

  const notes = [];
  if (
    typeof uia === "number" &&
    typeof handles === "number" &&
    handles >= 3 &&
    uia <= 1
  ) {
    notes.push(
      `UI Automation enumerates ${uia} window(s) while ${handles} window handle(s) exist. Snapshot then prints "No windows found" / "No elements" and Move/Click/Type report success without acting: this is upstream ${UPSTREAM_UIA_ISSUE}, not an install, mirror, or sandbox problem. Signing out of the Windows session (or rebooting) usually restores UI Automation; the durable fix has to land upstream.`,
    );
  }
  if (typeof scale === "number" && scale >= 1.25) {
    notes.push(
      `the primary display runs at ${Math.round(scale * 100)}% scaling. Upstream #607 divides absolute Move/Click coordinates by that factor, so requested positions land nearer the top-left than asked (1500,1100 arrives near ${Math.round(1500 / scale)},${Math.round(1100 / scale)} at this scale). Treat absolute coordinates as unreliable at non-100% scale and prefer reading positions from a Snapshot.`,
    );
  }
  return { line: parts.join(", "), notes };
}

/**
 * Run the probe once. Never rejects.
 *
 * @param options - optional timeout and spawn override (tests).
 * @returns measurements, `{ error }`, or `{ skipped }`.
 */
export function probeDesktop(options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : PROBE_TIMEOUT_MS;
  if (process.platform !== "win32") {
    return Promise.resolve({ skipped: "not a Windows host" });
  }
  const launcher = typeof options.spawn === "function" ? options.spawn : spawn;

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let child = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(value);
    };

    try {
      timer = setTimeout(() => {
        try {
          if (child !== null && typeof child.kill === "function") child.kill();
        } catch {
          /* the result is already decided */
        }
        finish({ error: `timed out after ${timeoutMs} ms` });
      }, timeoutMs);
      child = launcher(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PROBE_SCRIPT],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      finish({ error: String(error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    try {
      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on?.("data", (chunk) => {
        if (stdout.length < MAX_PROBE_OUTPUT) stdout += chunk;
      });
      child.stderr?.on?.("data", (chunk) => {
        if (stderr.length < MAX_PROBE_OUTPUT) stderr += chunk;
      });
      child.on?.("error", (error) => {
        finish({ error: String(error) });
      });
      child.on?.("close", (code) => {
        if (settled) return;
        const parsed = parseProbeOutput(stdout);
        if (parsed !== null) {
          finish(parsed);
          return;
        }
        const reason = stderr.trim().split(/\r?\n/u).pop() ?? "";
        finish({ error: reason === "" ? `powershell exited with code ${code}` : `powershell exited with code ${code}: ${reason}` });
      });
    } catch (error) {
      finish({ error: String(error) });
    }
  });
}
