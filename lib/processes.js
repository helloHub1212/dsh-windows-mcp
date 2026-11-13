/**
 * Which processes are running out of a directory.
 *
 * Windows locks the files of a running executable. `uv tool install --force`
 * removes the existing tool environment first, so re-installing the version the
 * bridge is currently running deletes `Lib` and then fails on the locked
 * `Scripts/windows-mcp.exe` — leaving an environment that cannot start. The
 * installer asks this module before it starts uv, and refuses while something
 * is still running from the target directory.
 *
 * The scan is read-only, best effort and bounded: one fixed PowerShell program,
 * no interpolation, a hard timeout, and a promise that resolves to an empty list
 * instead of throwing. An empty list means "nothing known", so a failed scan
 * never blocks an install on its own — uv reports the real failure if one exists.
 *
 * @module
 */

import { spawn } from "node:child_process";

/** Default wall-clock budget for one process scan. */
export const PROCESS_SCAN_TIMEOUT_MS = 5000;

/** Largest stdout slice a scan keeps; the real answer is a few short lines. */
const MAX_SCAN_OUTPUT = 64 * 1024;

/**
 * Fixed scan program. Kept ASCII-only so the console code page cannot corrupt
 * the paths; processes without an executable path (kernel, protected system
 * processes) are skipped because they cannot hold a tool directory open.
 */
const SCAN_SCRIPT =
  "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ForEach-Object { \"$($_.ProcessId)|$($_.ExecutablePath)\" }";

/**
 * Parse one `pid|path` line per process.
 *
 * @param text - raw stdout of the scan.
 * @returns the entries that parsed, in output order.
 */
export function parseProcessLines(text) {
  if (typeof text !== "string" || text === "") return [];
  const entries = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const separator = trimmed.indexOf("|");
    if (separator <= 0) continue;
    const pid = Number(trimmed.slice(0, separator));
    const path = trimmed.slice(separator + 1).trim();
    if (!Number.isInteger(pid) || pid <= 0 || path === "") continue;
    entries.push({ pid, path });
  }
  return entries;
}

/** Normalise a Windows path for prefix comparison (case-insensitive, backslashes). */
function comparablePath(value) {
  const text = String(value).replace(/\//gu, "\\").replace(/\\+$/u, "");
  return process.platform === "win32" ? text.toLowerCase() : text;
}

/**
 * Entries whose executable lives inside `root` (or is `root` itself).
 *
 * @param root - directory such as a managed version tool root.
 * @param entries - parsed process entries.
 * @returns matching entries.
 */
export function processesUnder(root, entries) {
  if (typeof root !== "string" || root === "" || !Array.isArray(entries)) return [];
  const wanted = comparablePath(root);
  if (wanted === "") return [];
  const prefix = wanted.endsWith("\\") ? wanted : `${wanted}\\`;
  return entries.filter((entry) => {
    if (entry === null || typeof entry !== "object" || typeof entry.path !== "string") return false;
    const actual = comparablePath(entry.path);
    return actual === wanted || actual.startsWith(prefix);
  });
}

/**
 * List the running processes that have an executable path, or an empty list.
 *
 * @param options - optional `timeoutMs`, `platform` and `spawn` overrides (the
 *   latter two exist for tests).
 */
export function listProcesses(options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : PROCESS_SCAN_TIMEOUT_MS;
  const platform = typeof options.platform === "string" ? options.platform : process.platform;
  if (platform !== "win32") return Promise.resolve([]);
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
        finish([]);
      }, timeoutMs);
      child = launcher(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCAN_SCRIPT],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      finish([]);
      return;
    }

    let stdout = "";
    try {
      child.stdout?.setEncoding?.("utf8");
      child.stdout?.on?.("data", (chunk) => {
        if (stdout.length < MAX_SCAN_OUTPUT) stdout += chunk;
      });
      child.on?.("error", () => finish([]));
      child.on?.("close", () => finish(parseProcessLines(stdout)));
      child.stderr?.on?.("data", () => {
        /* the exit code is enough; the scan is advisory */
      });
    } catch {
      finish([]);
    }
  });
}
