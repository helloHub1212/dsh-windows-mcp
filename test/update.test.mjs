/**
 * Test suite for the version manager: `npm test` (node --test).
 *
 * The risky surfaces this file covers, in the order a user hits them:
 *   1. **version maths & index parsing** — a wrong "newest stable" or a broken
 *      relative-URL join would download the wrong file;
 *   2. **mirror selection** — probing must rank by measured speed and the
 *      install order must fall back to the mirrors that did not win;
 *   3. **version isolation** — every managed version lives in its own
 *      `UV_TOOL_DIR`, so keeping the previous one and rolling back needs no
 *      download at all;
 *   4. **the manager itself** — check → install → activate → rollback against
 *      injected seams (`probe`, `readIndex`, `spawnInstall`, `writeBridge`), so
 *      the whole flow is tested without a network or a real `uv`.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { uvInstallEnvironment, spawnUvInstall, createPrepare } from "../lib/dependency.js";
import {
  activateVersion,
  activeInstall,
  emptyVersionsState,
  executableIn,
  listManagedVersions,
  managedToolchainRoot,
  readManifest,
  readVersionsState,
  toolDirectoryFor,
  versionToolRoot,
  versionsStatePath,
  writeManifest,
  writeVersionsState,
} from "../lib/installs.js";
import {
  formatBytesPerSecond,
  mirrorOrder,
  probeMirrors,
  preferredMirror,
} from "../lib/mirrors.js";
import {
  compareVersions,
  entryForVersion,
  isStableVersion,
  latestStableEntry,
  latestStableVersion,
  parseIndex,
  projectIndexUrl,
  versionFromFilename,
} from "../lib/pypi.js";
import { CHECK_TTL_MS, UPDATE_ROUTE, createUpdater } from "../lib/updater.js";

const INDEX_HTML = `<!DOCTYPE html><html><body>
<a href="../../packages/aa/windows_mcp-0.8.8-py3-none-any.whl#sha256=abc">windows_mcp-0.8.8-py3-none-any.whl</a>
<a href="../../packages/bb/windows_mcp-0.8.7-py3-none-any.whl">windows_mcp-0.8.7-py3-none-any.whl</a>
<a href="../../packages/cc/windows_mcp-0.9.0rc1-py3-none-any.whl" data-yanked="true">windows_mcp-0.9.0rc1-py3-none-any.whl</a>
<a href="../../packages/dd/windows_mcp-0.8.8.tar.gz">windows_mcp-0.8.8.tar.gz</a>
</body></html>`;

const MIRRORS = [
  { id: "slow", label: "Slow Mirror", indexUrl: "https://slow.example/simple", official: false },
  { id: "fast", label: "Fast Mirror", indexUrl: "https://fast.example/simple", official: false },
  { id: "pypi", label: "PyPI", indexUrl: "https://pypi.example/simple", official: true },
];

function temporaryHome() {
  return mkdtempSync(join(tmpdir(), "dwmc-update-home-"));
}

/** Create the on-disk shape `uv tool install` leaves for one managed version. */
function fakeInstall(root, version) {
  const toolDirectory = toolDirectoryFor(root, version);
  mkdirSync(join(toolDirectory, "Lib", "site-packages", `windows_mcp-${version}.dist-info`), { recursive: true });
  const executable = join(toolDirectory, "Scripts", "windows-mcp.exe");
  mkdirSync(join(toolDirectory, "Scripts"), { recursive: true });
  writeFileSync(executable, "fake");
  return executable;
}

/** A `spawnInstall` replacement that "installs" into the version's own root. */
function fakeSpawner(root, options = {}) {
  const calls = [];
  const spawner = (settings) => {
    calls.push(settings);
    const version = settings.spec.split("@").pop();
    const child = new EventEmitter();
    child.kill = () => {
      child.killed = true;
    };
    setImmediate(() => {
      if (typeof options.failFor === "function" && options.failFor(settings) === true) {
        child.emit("close", 2);
        return;
      }
      fakeInstall(root, version);
      child.emit("close", 0);
    });
    return { child, args: [settings.spec] };
  };
  spawner.calls = calls;
  return spawner;
}

function fakeFetch() {
  return async (url, init = {}) => {
    if (String(init?.headers?.range ?? init?.headers?.Range ?? "").startsWith("bytes=")) {
      return { ok: true, status: 206, arrayBuffer: async () => new ArrayBuffer(96 * 1024) };
    }
    return { ok: true, status: 200, text: async () => INDEX_HTML };
  };
}

async function waitForPhase(snapshot, phase, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = snapshot();
    if (current.phase === phase) return current;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for phase ${phase}; last was ${snapshot().phase}`);
}

/* ------------------------------------------------------------------ *
 * 1. version maths and index parsing
 * ------------------------------------------------------------------ */

test("PyPI version maths keeps prereleases out of the stable channel", () => {
  assert.equal(isStableVersion("0.8.8"), true);
  assert.equal(isStableVersion("0.9.0rc1"), false);
  assert.equal(isStableVersion("0.8.9.dev1"), false);
  assert.ok(compareVersions("0.8.8", "0.8.7") > 0);
  assert.ok(compareVersions("0.10.0", "0.9.9") > 0);
  assert.equal(compareVersions("0.8.8", "0.8.8"), 0);
  assert.equal(latestStableVersion(["0.8.7", "0.9.0rc1", "0.8.8"]), "0.8.8");
  assert.equal(latestStableVersion(["1.0.0rc2", "1.0.0"], ), "1.0.0");
  assert.equal(latestStableVersion([]), null);
  assert.equal(versionFromFilename("windows_mcp-0.8.8-py3-none-any.whl"), "0.8.8");
  assert.equal(versionFromFilename("windows_mcp-0.8.8.tar.gz"), "0.8.8");
  assert.equal(versionFromFilename("other-1.0.0-py3-none-any.whl"), null);
  assert.equal(projectIndexUrl("https://mirror.example/simple", "windows-mcp"), "https://mirror.example/simple/windows-mcp/");
  assert.equal(projectIndexUrl("https://mirror.example/simple/", "windows-mcp"), "https://mirror.example/simple/windows-mcp/");
});

test("the index parser resolves mirror-relative links and marks yanked files", () => {
  const pageUrl = "https://mirror.example/simple/windows-mcp/";
  const entries = parseIndex(INDEX_HTML, pageUrl);
  assert.equal(entries.length, 4);
  const wheel = entries.find((entry) => entry.filename === "windows_mcp-0.8.8-py3-none-any.whl");
  assert.equal(wheel.version, "0.8.8");
  assert.equal(wheel.stable, true);
  assert.equal(wheel.url, "https://mirror.example/packages/aa/windows_mcp-0.8.8-py3-none-any.whl#sha256=abc");
  const yanked = entries.find((entry) => entry.filename === "windows_mcp-0.9.0rc1-py3-none-any.whl");
  assert.equal(yanked.yanked, true);
  assert.equal(latestStableEntry(entries)?.version, "0.8.8", "yanked prereleases must not win");
  assert.equal(entryForVersion(entries, "0.8.8")?.filename, "windows_mcp-0.8.8-py3-none-any.whl", "a wheel beats an sdist");
  assert.equal(entryForVersion(entries, "9.9.9"), null);
});

/* ------------------------------------------------------------------ *
 * 2. mirror probing and install order
 * ------------------------------------------------------------------ */

test("mirror probing measures each candidate and ranks the fastest first", async () => {
  const probe = await probeMirrors({ candidates: MIRRORS, fetchImpl: fakeFetch(), concurrency: 3, timeoutMs: 2000 });
  assert.equal(probe.results.length, 3);
  assert.ok(probe.results.every((result) => result.ok === true));
  assert.ok(probe.results.every((result) => typeof result.speedBps === "number" && result.speedBps > 0));
  assert.equal(probe.ranked.length, 3);
  assert.equal(mirrorOrder(probe, MIRRORS).at(-1)?.official, true, "the official index is the last resort");

  const order = mirrorOrder({ ranked: ["fast"] }, MIRRORS);
  assert.deepEqual(order.map((mirror) => mirror.id), ["fast", "pypi", "slow"]);
  assert.equal(preferredMirror({ ranked: ["fast"] }, MIRRORS)?.id, "fast");
  assert.equal(preferredMirror(null, MIRRORS)?.id, "pypi", "with no probe the official index goes first");

  assert.equal(formatBytesPerSecond(1.7 * 1024 * 1024), "1.7 MB/s");
  assert.equal(formatBytesPerSecond(820 * 1024), "820 KB/s");
  assert.equal(formatBytesPerSecond(0), "—");
});

/* ------------------------------------------------------------------ *
 * 3. version isolation, manifests and the versions file
 * ------------------------------------------------------------------ */

test("every managed version gets its own tool root, so a rollback needs no download", () => {
  const home = temporaryHome();
  try {
    const root = managedToolchainRoot(home);
    assert.equal(root, join(home, "dsh-windows-mcp", "toolchain"));
    assert.equal(versionToolRoot(root, "0.8.8"), join(root, "0.8.8"));
    assert.equal(versionToolRoot(root, "0.8.8"), join(root, "0.8.8"));
    assert.equal(toolDirectoryFor(root, "0.8.8"), join(root, "0.8.8", "windows-mcp"));
    assert.throws(() => versionToolRoot(root, "../escape"), /invalid/i);

    const executable = fakeInstall(root, "0.8.8");
    assert.equal(executableIn(toolDirectoryFor(root, "0.8.8")), executable);
    fakeInstall(root, "0.8.7");
    assert.deepEqual(
      listManagedVersions(root).map((entry) => entry.version),
      ["0.8.8", "0.8.7"],
      "newest managed version first",
    );

    writeManifest(root, "0.8.8", { executable, indexUrl: "https://fast.example/simple", mirror: "fast" });
    assert.equal(readManifest(root, "0.8.8")?.mirror, "fast");
    assert.equal(readManifest(root, "0.8.7"), null);

    assert.deepEqual(emptyVersionsState(), {
      version: 1,
      active: null,
      previous: null,
      history: [],
      lastCheck: null,
    });
    const first = writeVersionsState(activateVersion(emptyVersionsState(), "0.8.8"), home);
    assert.equal(first.active, "0.8.8");
    assert.equal(first.previous, null);
    const second = writeVersionsState(activateVersion(first, "0.8.7"), home);
    assert.equal(second.active, "0.8.7");
    assert.equal(second.previous, "0.8.8");
    const third = writeVersionsState(activateVersion(second, "0.8.8"), home);
    assert.equal(third.active, "0.8.8");
    assert.equal(third.previous, "0.8.7");
    assert.deepEqual(readVersionsState(home).history.map((entry) => entry.version), ["0.8.8", "0.8.7", "0.8.8"]);
    assert.ok(existsSync(versionsStatePath(home)));
    assert.equal(activeInstall(readVersionsState(home), home)?.version, "0.8.8");
    assert.equal(activeInstall(emptyVersionsState(), home), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 4. the manager: check → install → activate → rollback
 * ------------------------------------------------------------------ */

test("the manager checks the mirrors once, then installs, activates and rolls back", async () => {
  const home = temporaryHome();
  try {
    const root = managedToolchainRoot(home);
    let probes = 0;
    let bridgeWrites = [];
    const spawnInstall = fakeSpawner(root);
    const updater = createUpdater({
      home,
      warn: () => {},
      resolver: () => "C:\\fake\\uv.exe",
      pinned: "0.8.8",
      writeBridge: (executable) => {
        bridgeWrites.push(executable);
        return { ok: true, restartRequired: true };
      },
      probe: async () => {
        probes += 1;
        return {
          probedAt: new Date().toISOString(),
          results: [
            { id: "ustc", label: "USTC 中科大", ok: true, speedBps: 1.7 * 1024 * 1024, indexMs: 104 },
            { id: "pypi", label: "PyPI", ok: true, speedBps: 400 * 1024, indexMs: 900 },
          ],
          ranked: ["ustc", "pypi"],
          best: null,
          project: "windows-mcp",
        };
      },
      readIndex: async ({ indexUrl }) => {
        assert.match(indexUrl, /simple/u);
        return { indexUrl, latest: "0.8.8", versions: ["0.8.8", "0.8.7"] };
      },
      spawnInstall,
      now: () => Date.now(),
    });

    assert.equal(updater.view().check.phase, "idle");
    assert.equal(updater.view().install.phase, "idle");
    assert.equal(UPDATE_ROUTE, "/dsh-windows-mcp/update");

    const checked = await updater.check({ force: true });
    assert.equal(checked.check.phase, "ok");
    assert.equal(checked.check.latest, "0.8.8");
    assert.equal(checked.check.best, "ustc", "the fastest mirror that answers wins the check");
    assert.equal(probes, 1);
    assert.equal(readVersionsState(home).lastCheck?.latest, "0.8.8");
    assert.equal(readVersionsState(home).lastCheck?.at, checked.check.at);
    assert.ok(Date.now() - Date.parse(checked.check.at) < CHECK_TTL_MS);

    // a non-forced check inside the TTL is served from the persisted record
    await updater.check({});
    assert.equal(probes, 1, "a fresh check must not probe again");

    const first = await updater.installVersion("0.8.8");
    assert.equal(first.ok, true);
    assert.equal(bridgeWrites.length, 1);
    assert.match(bridgeWrites[0], /windows-mcp\.exe$/u);
    assert.equal(updater.view().versions.active, "0.8.8");
    assert.equal(updater.view().versions.previous, null);
    assert.equal(updater.view().install.phase, "ok");
    assert.deepEqual(updater.view().versions.available, ["0.8.8"]);
    assert.equal(spawnInstall.calls.at(-1)?.indexUrl, "https://mirrors.ustc.edu.cn/pypi/simple");
    assert.deepEqual(spawnInstall.calls.at(-1)?.toolDirectory ?? "", join(root, "0.8.8"));

    const second = await updater.installVersion("0.8.7");
    assert.equal(second.ok, true);
    assert.equal(updater.view().versions.active, "0.8.7");
    assert.equal(updater.view().versions.previous, "0.8.8");
    assert.deepEqual(updater.view().versions.available, ["0.8.8", "0.8.7"]);

    const rolledBack = await updater.rollback();
    assert.equal(rolledBack.ok, true);
    assert.equal(rolledBack.rolledBackFrom, "0.8.7");
    assert.equal(bridgeWrites.length, 3);
    assert.equal(updater.view().versions.active, "0.8.8");
    assert.equal(updater.view().versions.previous, "0.8.7");

    const activated = updater.activateInstalled("0.8.7");
    assert.equal(activated.ok, true);
    assert.equal(updater.view().versions.active, "0.8.7");
    assert.equal(updater.activateInstalled("9.9.9").ok, false);

    const legacy = { installed: false, executable: "C:\\global\\windows-mcp.exe", version: null, pinned: "0.8.8" };
    const dependency = updater.dependencyView(legacy);
    assert.equal(dependency.installed, true);
    assert.equal(dependency.source, "managed");
    assert.equal(dependency.version, "0.8.7");
    assert.equal(dependency.executable, join(toolDirectoryFor(root, "0.8.7"), "Scripts", "windows-mcp.exe"));
    assert.equal(dependency.managed.active, "0.8.7");
    assert.equal(dependency.managed.previous, "0.8.8");
    assert.deepEqual(dependency.managed.available, ["0.8.8", "0.8.7"]);

    assert.equal(updater.view().versions.updateAvailable, true, "0.8.7 is active while 0.8.8 is the latest");
    await updater.whenIdle();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an install falls back to the next mirror when one fails", async () => {
  const home = temporaryHome();
  try {
    const root = managedToolchainRoot(home);
    const spawnInstall = fakeSpawner(root, { failFor: (settings) => settings.indexUrl.includes("ustc") });
    const updater = createUpdater({
      home,
      warn: () => {},
      resolver: () => "C:\\fake\\uv.exe",
      pinned: "0.8.8",
      writeBridge: () => ({ ok: true, restartRequired: true }),
      probe: async () => ({
        results: [
          { id: "ustc", label: "USTC", ok: true, speedBps: 2 * 1024 * 1024, indexMs: 10 },
          { id: "aliyun", label: "Aliyun", ok: true, speedBps: 1024 * 1024, indexMs: 20 },
        ],
        ranked: ["ustc", "aliyun"],
      }),
      readIndex: async ({ indexUrl }) => ({ indexUrl, latest: "0.8.8", versions: ["0.8.8"] }),
      spawnInstall,
    });

    const result = await updater.installVersion("0.8.8");
    assert.equal(result.ok, true);
    assert.equal(result.mirror, "aliyun");
    assert.equal(spawnInstall.calls.length, 2, "the failing mirror is retried as the next candidate");
    assert.ok(updater.view().install.log.some((line) => line.startsWith("failed:")), "a failed attempt is reported");
    assert.equal(updater.view().versions.active, "0.8.8");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * 5. install plumbing: env, arguments, streamed log
 * ------------------------------------------------------------------ */

test("uv installs run with the mirror-safe environment and the managed tool dir", () => {
  const withDir = uvInstallEnvironment("C:\\tmp\\toolroot");
  assert.equal(withDir.UV_TOOL_DIR, "C:\\tmp\\toolroot");
  assert.equal(withDir.UV_CONCURRENT_DOWNLOADS, "4", "mirrors rate-limit the default of eight");
  assert.equal(withDir.UV_HTTP_TIMEOUT, "600");
  assert.equal(withDir.UV_HTTP_RETRIES, "3");
  assert.equal(uvInstallEnvironment().UV_TOOL_DIR, undefined, "the global install keeps the default tool dir");
});

test("spawnUvInstall passes the chosen mirror and streams output", async () => {
  const started = spawnUvInstall({
    uv: process.execPath,
    spec: "windows-mcp@0.8.8",
    indexUrl: "https://fast.example/simple",
    toolDirectory: join(tmpdir(), "dwmc-args"),
  });
  assert.deepEqual(started.args, ["tool", "install", "--force", "--default-index", "https://fast.example/simple", "windows-mcp@0.8.8"]);
  await new Promise((resolve) => started.child.on("close", resolve));

  const plain = spawnUvInstall({ uv: process.execPath, spec: "windows-mcp@0.8.8" });
  assert.deepEqual(plain.args, ["tool", "install", "--force", "windows-mcp@0.8.8"]);
  await new Promise((resolve) => plain.child.on("close", resolve));
});

test("createPrepare streams the mirror and the managed tool directory", async () => {
  const toolDirectory = join(tmpdir(), "dwmc-prepare-toolroot");
  const prepare = createPrepare({
    warn: () => {},
    resolver: () => process.execPath,
    pinned: "0.8.8",
    indexUrl: "https://fast.example/simple",
    toolDirectory,
    resolveExecutable: () => "C:\\fake\\windows-mcp.exe",
  });
  const started = prepare.start();
  assert.equal(started.started, true);
  assert.equal(started.state.phase, "running");
  assert.equal(started.state.log[0], `$ ${process.execPath} tool install --force --default-index https://fast.example/simple windows-mcp@0.8.8  (UV_TOOL_DIR=${toolDirectory})`);

  const settled = await waitForPhase(() => prepare.snapshot(), "failed");
  assert.match(settled.error, /uv exited with code/u);
  const retried = prepare.start();
  assert.equal(retried.started, true, "a failed run may be retried");
  await waitForPhase(() => prepare.snapshot(), "failed");
  prepare.cancel();
});
