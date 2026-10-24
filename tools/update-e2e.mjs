#!/usr/bin/env node
/**
 * Manual end-to-end harness for the Windows-MCP version manager.
 *
 * The automated suite (`npm test`) drives the manager through injected seams —
 * no network, no `uv`, no profile writes. This script is the opposite: it runs
 * the **real** thing against the internet and this machine's DSH profile, so a
 * maintainer can prove that checking, installing, activating and rolling back
 * work before cutting a release.
 *
 *   node tools/update-e2e.mjs --check                    # probe mirrors, read the newest version
 *   node tools/update-e2e.mjs --install 0.8.8            # download + activate (rewrites the bridge row)
 *   node tools/update-e2e.mjs --install 0.8.8 --no-bridge# download only, leave the profile alone
 *   node tools/update-e2e.mjs --activate 0.8.7           # switch to an installed version
 *   node tools/update-e2e.mjs --rollback                 # back to the version the active one replaced
 *   node tools/update-e2e.mjs --state                    # print the persisted versions state
 *
 * This is a development tool: it is not published to npm and it is not part of
 * the plugin runtime.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { dshHome, windowsMcpVersionPin, writeBridgeOverride } from "../lib/dependency.js";
import { readVersionsState, versionsStatePath } from "../lib/installs.js";
import { createUpdater } from "../lib/updater.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

/** `uv` from the PATH (the plugin uses the same lookup). */
function resolveUv() {
  try {
    const found = execFileSync(process.platform === "win32" ? "where.exe" : "which", ["uv"], { encoding: "utf8" })
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line !== "");
    return found ?? null;
  } catch {
    return null;
  }
}

const pinned = (() => {
  try {
    // The pin lives in the plugin's own carrier patch, exactly like at runtime.
    return windowsMcpVersionPin(readFileSync(`${packageRoot}cordis.patch.yml`, "utf8"));
  } catch {
    return null;
  }
})();

const updater = createUpdater({
  warn: (message) => console.warn(`[warn] ${message}`),
  resolver: () => resolveUv(),
  pinned,
  writeBridge: flag("--no-bridge")
    ? undefined
    : (executable) => writeBridgeOverride(executable, { warn: (message) => console.warn(`[warn] ${message}`), version: "dev" }),
});

const summarizeCheck = (view) => ({
  phase: view.check.phase,
  latest: view.check.latest,
  bestMirror: view.check.best,
  fresh: view.check.fresh,
  at: view.check.at,
  error: view.check.error,
  mirrors: view.check.mirrors.map((mirror) => ({
    id: mirror.id,
    label: mirror.label,
    ok: mirror.ok,
    speed: mirror.ok ? `${Math.round((mirror.speedBps ?? 0) / 1024)} KB/s` : null,
    error: mirror.error,
  })),
});

const summarizeInstall = (view) => ({
  phase: view.install.phase,
  version: view.install.version,
  mirror: view.install.mirror,
  error: view.install.error,
  bridge: view.install.bridge === null ? null : { ok: view.install.bridge.ok, path: view.install.bridge.path, restartRequired: view.install.bridge.restartRequired },
  logTail: view.install.log.slice(-6),
});

const summarizeVersions = (view) => ({
  pinned: view.versions.pinned,
  active: view.versions.active,
  previous: view.versions.previous,
  available: view.versions.available,
  updateAvailable: view.versions.updateAvailable,
  toolchainRoot: view.versions.toolchainRoot,
  activeExecutable: view.versions.activeExecutable,
});

try {
  if (flag("--state")) {
    console.log(JSON.stringify({ statePath: versionsStatePath(dshHome()), state: readVersionsState(dshHome()) }, null, 2));
  } else if (value("--install") !== null) {
    console.log(JSON.stringify({ pinned, uv: resolveUv() }, null, 2));
    const result = await updater.installVersion(value("--install"));
    console.log(JSON.stringify({ result: { ok: result.ok, version: result.version, mirror: result.mirror, error: result.error } }, null, 2));
    console.log(JSON.stringify({ install: summarizeInstall(result.view), versions: summarizeVersions(result.view) }, null, 2));
  } else if (value("--activate") !== null) {
    const result = updater.activateInstalled(value("--activate"));
    console.log(JSON.stringify({ result: { ok: result.ok, version: result.version, error: result.error }, versions: summarizeVersions(result.view) }, null, 2));
  } else if (flag("--rollback")) {
    const result = await updater.rollback();
    console.log(JSON.stringify({ result: { ok: result.ok, rolledBackFrom: result.rolledBackFrom, error: result.error }, versions: summarizeVersions(result.view) }, null, 2));
  } else {
    const view = await updater.check({ force: flag("--force") || !flag("--cached") });
    console.log(JSON.stringify({ pinned, uv: resolveUv(), check: summarizeCheck(view), versions: summarizeVersions(view) }, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
