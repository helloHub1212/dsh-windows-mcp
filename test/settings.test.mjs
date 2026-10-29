/**
 * dsh-windows-mcp — settings page tests.
 *
 * Two layers:
 *   1. the pure settings helpers (validation, storage, bridge round-trip);
 *   2. the host route the settings page talks to, exercised through the same
 *      fake cordis context the plugin tests use.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bridgeOverrideBlock, writeBridgeOverride } from "../lib/dependency.js";
import { MIRROR_CANDIDATES, mirrorCandidates } from "../lib/mirrors.js";
import {
  DEFAULT_SETTINGS,
  SETTINGS_ROUTE,
  bridgeSettingsMatch,
  bridgeSettingsOf,
  defaultSettings,
  normalizeSettings,
  readBridgeSettings,
  readSettings,
  settingsPath,
  writeSettings,
} from "../lib/settings.js";

function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(chunk) {
      this.body += typeof chunk === "string" ? chunk : "";
      return this;
    },
  };
}

function fakeRequest(method, body) {
  const listeners = new Map();
  return {
    method,
    on(event, listener) {
      listeners.set(event, listener);
      return this;
    },
    destroy() {},
    start() {
      if (body !== undefined && listeners.has("data")) listeners.get("data")(Buffer.from(body));
      if (listeners.has("end")) listeners.get("end")();
    },
  };
}

test("settings normalisation clamps values and names what it replaced", () => {
  const { settings, problems } = normalizeSettings({
    bridge: {
      toolCallTimeoutMs: 1,
      excludeTools: ["App", "NotATool", "App"],
      screenshotScale: 0.5,
      screenshotBackend: "dxcam",
      disableFlash: "no",
    },
    plugin: { autoCheckUpdates: "yes", preferredMirror: "ustc" },
  });

  assert.equal(settings.bridge.toolCallTimeoutMs, DEFAULT_SETTINGS.bridge.toolCallTimeoutMs);
  assert.deepEqual(settings.bridge.excludeTools, ["App"], "unknown tools and duplicates are dropped");
  assert.equal(settings.bridge.screenshotScale, 0.5);
  assert.equal(settings.bridge.screenshotBackend, "dxcam");
  assert.equal(settings.bridge.disableFlash, DEFAULT_SETTINGS.bridge.disableFlash);
  assert.equal(settings.plugin.autoCheckUpdates, true);
  assert.equal(settings.plugin.preferredMirror, "ustc");

  for (const field of ["bridge.toolCallTimeoutMs", "bridge.excludeTools", "bridge.disableFlash", "plugin.autoCheckUpdates"]) {
    assert.ok(problems.includes(field), `${field} is reported as replaced`);
  }
});

test("settings round-trip through the host file, and corruption falls back", () => {
  const home = mkdtempSync(join(tmpdir(), "dwmc-settings-"));

  assert.deepEqual(readSettings(home), defaultSettings(), "a missing file means defaults");

  const stored = writeSettings({ plugin: { autoCheckUpdates: false, preferredMirror: "nju" } }, home);
  assert.equal(stored.written, true);
  assert.ok(existsSync(settingsPath(home)));

  const back = readSettings(home);
  assert.equal(back.plugin.preferredMirror, "nju");
  assert.equal(back.plugin.autoCheckUpdates, false);
  assert.equal(back.bridge.toolCallTimeoutMs, DEFAULT_SETTINGS.bridge.toolCallTimeoutMs);

  writeFileSync(settingsPath(home), "{ not json", "utf8");
  assert.deepEqual(readSettings(home), defaultSettings(), "a corrupt file never throws");
});

test("the bridge row carries custom values and reads back unchanged", () => {
  const custom = defaultSettings();
  custom.bridge.toolCallTimeoutMs = 45000;
  custom.bridge.excludeTools = [];
  custom.bridge.screenshotScale = 0.5;
  custom.bridge.screenshotBackend = "mss";
  custom.bridge.disableFlash = false;

  const block = bridgeOverrideBlock("C:", { settings: custom.bridge, stamp: "2026-01-01T00:00:00.000Z", version: "9.9.9" });
  assert.match(block, /args: \[serve\]/u, "no --exclude-tools when nothing is hidden");
  assert.match(block, /toolCallTimeoutMs: 45000/u);
  assert.doesNotMatch(block, /WINDOWS_MCP_DISABLE_FLASH/u);
  assert.match(block, /WINDOWS_MCP_SCREENSHOT_SCALE: "0.5"/u);
  assert.match(block, /WINDOWS_MCP_SCREENSHOT_BACKEND: "mss"/u);

  const parsed = readBridgeSettings(block);
  assert.equal(parsed.toolCallTimeoutMs, 45000);
  assert.deepEqual(parsed.excludeTools, []);
  assert.equal(parsed.screenshotScale, 0.5);
  assert.equal(parsed.screenshotBackend, "mss");
  assert.equal(parsed.disableFlash, false);
  assert.equal(bridgeSettingsMatch(custom, block), true);
  assert.equal(bridgeSettingsMatch(defaultSettings(), block), false);
});

test("the default bridge row is unchanged and matches the defaults", () => {
  const block = bridgeOverrideBlock("C:\\uv\\windows-mcp.exe");
  assert.match(block, /args: \[serve, --exclude-tools, "App,PowerShell,FileSystem"\]/u);
  assert.match(block, /toolCallTimeoutMs: 120000/u);
  assert.match(
    block,
    /env: \{ ANONYMIZED_TELEMETRY: "false", WINDOWS_MCP_DISABLE_FLASH: "1", WINDOWS_MCP_SCREENSHOT_SCALE: "0.75" \}/u,
  );
  assert.equal(readBridgeSettings(block).toolCallTimeoutMs, 120000);
  assert.equal(bridgeSettingsMatch(defaultSettings(), block), true);
});

test("the profile writer keeps the user settings when it rewrites the patch", () => {
  const home = mkdtempSync(join(tmpdir(), "dwmc-settings-write-"));
  const profile = join(home, "profiles", "test");
  mkdirSync(join(profile, "node_modules", "dsh-windows-mcp"), { recursive: true });
  writeFileSync(join(profile, "cordis.patch.yml"), "# my patch layer\n", "utf8");
  const executable = join(home, "windows-mcp.exe");
  writeFileSync(executable, "", "utf8");

  const custom = defaultSettings();
  custom.bridge.toolCallTimeoutMs = 30000;
  custom.bridge.excludeTools = ["PowerShell"];

  const result = writeBridgeOverride(executable, {
    home,
    env: { DSH_PROFILE_DIR: profile },
    version: "0.2.1",
    settings: bridgeSettingsOf(custom),
  });
  assert.equal(result.ok, true);
  const text = readFileSync(result.path, "utf8");
  assert.match(text, /toolCallTimeoutMs: 30000/u);
  assert.match(text, /--exclude-tools, "PowerShell"/u);
  assert.match(text, /# my patch layer/u, "the rest of the file survives");
  assert.equal(bridgeSettingsMatch(custom, text), true);
});

test("mirror candidates honour a pinned mirror and keep the shipped order otherwise", () => {
  const pinned = mirrorCandidates("ustc");
  assert.equal(pinned[0].id, "ustc");
  assert.equal(pinned.length, MIRROR_CANDIDATES.length);
  assert.deepEqual(mirrorCandidates("auto").map((mirror) => mirror.id), MIRROR_CANDIDATES.map((mirror) => mirror.id));
  assert.deepEqual(mirrorCandidates("nope").map((mirror) => mirror.id), MIRROR_CANDIDATES.map((mirror) => mirror.id));
});

test("the host registers the settings route and answers GET/POST", async () => {
  const home = mkdtempSync(join(tmpdir(), "dwmc-settings-route-"));
  process.env.DSH_HOME = home;
  const fresh = await import(`../lib/index.js?settings-route=${Date.now()}`);

  const routes = new Map();
  const tools = { schemas: () => [["mcp__windows__Screenshot", {}]] };
  fresh.apply({
    logger: { warn() {} },
    inject(services, callback) {
      if (services.includes("webServer")) {
        callback({
          webServer: {
            register(candidate) {
              routes.set(candidate.path, candidate);
              return () => {};
            },
          },
          get: (key) => (key === "tools" ? tools : undefined),
        });
        return;
      }
      callback({ tools: { register() { return () => {}; }, guard() { return () => {}; } } });
    },
  });

  const route = routes.get(SETTINGS_ROUTE);
  assert.ok(route, "the settings route must be registered");
  assert.equal(route.kind, "exact");

  const get = fakeResponse();
  route.handler({ method: "GET" }, get);
  assert.equal(get.status, 200);
  const body = JSON.parse(get.body);
  assert.equal(body.settings.bridge.toolCallTimeoutMs, 120000);
  assert.equal(body.settings.plugin.preferredMirror, "auto");
  assert.equal(typeof body.pluginVersion, "string");
  assert.equal(body.restartRequired, false, "the shipped defaults need no restart");

  const post = fakeResponse();
  const request = fakeRequest("POST", JSON.stringify({ settings: { plugin: { autoCheckUpdates: false, preferredMirror: "ustc" } } }));
  route.handler(request, post);
  request.start();
  assert.equal(post.status, 200);
  const saved = JSON.parse(post.body);
  assert.equal(saved.ok, true, "a plugin-only change writes no patch row");
  assert.equal(saved.settings.plugin.autoCheckUpdates, false);
  assert.equal(saved.settings.plugin.preferredMirror, "ustc");
  assert.equal(JSON.parse(readFileSync(join(home, "dsh-windows-mcp.settings.json"), "utf8")).plugin.preferredMirror, "ustc");

  const bridgeChange = fakeResponse();
  const bridgeRequest = fakeRequest("POST", JSON.stringify({ settings: { bridge: { screenshotScale: 0.5 } } }));
  route.handler(bridgeRequest, bridgeChange);
  bridgeRequest.start();
  assert.equal(bridgeChange.status, 200);
  const changed = JSON.parse(bridgeChange.body);
  assert.equal(changed.settings.bridge.screenshotScale, 0.5, "the value is stored even without an install");
  assert.equal(changed.restartRequired, true, "a bridge change only applies after a restart");

  const wrongMethod = fakeResponse();
  route.handler({ method: "DELETE" }, wrongMethod);
  assert.equal(wrongMethod.status, 405);

  const badBody = fakeResponse();
  const badRequest = fakeRequest("POST", "{ nope");
  route.handler(badRequest, badBody);
  badRequest.start();
  assert.equal(badBody.status, 400);
});
