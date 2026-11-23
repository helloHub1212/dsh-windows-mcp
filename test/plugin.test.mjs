/**
 * Test suite: `npm test` (node --test).
 *
 * Three layers of risk, three layers of checking:
 *   1. the patch file must stay a composable carrier patch — parsed for real with
 *      js-yaml when available, so a broken YAML or a renamed row fails here
 *      instead of failing a user's DSH boot;
 *   2. the host half must be unkillable — `apply()` runs against hostile contexts
 *      (no context, no logger, a logger that throws, an `inject` that throws) and
 *      must never propagate an exception, because a throw in `apply()` fails the
 *      loader fiber and reports "Failed to load plugins";
 *   3. the client half must register into the shipped composer slot and render a
 *      real switch — checked offline with a stubbed module loader and a stubbed
 *      React, so a typo in the slot name or the ARIA wiring fails the build.
 *
 * js-yaml is a devDependency only; when it is missing the structural assertions
 * still run.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import plugin, { apply } from "../lib/index.js";
import {
  bridgeOverrideBlock,
  createPrepare,
  currentProfileDirectory,
  dshHome,
  preferredProfileDirectory,
  profileFromArgv,
  windowsMcpVersionPin,
  withBridgeOverride,
  writeBridgeOverride,
  yamlScalar,
} from "../lib/dependency.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const patchText = readFileSync(join(packageRoot, "cordis.patch.yml"), "utf8");
const clientSource = readFileSync(join(packageRoot, "lib", "client.js"), "utf8");

let yaml = null;
try {
  yaml = await import("js-yaml");
} catch {
  yaml = null;
}

/* ------------------------------------------------------------------ *
 * package shape
 * ------------------------------------------------------------------ */

test("package manifest declares a carrier bundle patch", () => {
  assert.equal(manifest.name, "dsh-windows-mcp");
  assert.equal(manifest.dsh?.bundle?.patch, "./cordis.patch.yml");
  assert.ok(existsSync(join(packageRoot, "cordis.patch.yml")), "patch file must exist");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.main, "./lib/index.js");
  assert.equal(manifest.dependencies, undefined, "runtime must stay dependency-free");
});

test("package manifest declares the web client half", () => {
  assert.equal(manifest.dsh?.client?.platform, "web");
  assert.equal(manifest.exports?.["./client"], "./lib/client.js");
  assert.ok(existsSync(join(packageRoot, "lib", "client.js")));
});

test("every file published by npm is present on disk", () => {
  for (const entry of manifest.files ?? []) {
    assert.ok(existsSync(join(packageRoot, entry)), `published entry missing: ${entry}`);
  }
});

/* ------------------------------------------------------------------ *
 * patch layer
 * ------------------------------------------------------------------ */

test("patch mounts exactly the plugin row and the official bridge row", () => {
  if (yaml === null) return; // no devDependencies installed: skip the deep check
  const patch = yaml.load(patchText);
  assert.ok(Array.isArray(patch), "patch must be a top-level array");

  const insert = patch.find((entry) => Array.isArray(entry?.insert));
  assert.ok(insert, "patch must contain an `insert:` entry");
  assert.equal(insert.insert.length, 2);

  const [pluginRow, bridgeRow] = insert.insert;
  assert.equal(pluginRow.id, "windows-mcp-plugin");
  assert.equal(pluginRow.name, "dsh-windows-mcp");
  assert.equal(bridgeRow.id, "windows-mcp-bridge");
  assert.equal(bridgeRow.name, "@deepseek-ai/dsh-mcp-client", "must reuse the in-box bridge");

  const config = bridgeRow.config;
  assert.equal(
    bridgeRow.disabled,
    true,
    "the bridge ships inert: a cold `uvx` resolve inside DSH's startup can hang the window on Loading plugins…",
  );
  assert.equal(config.transport, "stdio");
  assert.equal(config.serverName, "windows", "serverName drives the mcp__windows__ prefix");
  assert.equal(config.command, "uvx", "fallback command, only used if the row is re-enabled without a rewrite");
  assert.ok(Array.isArray(config.args));
  assert.ok(config.args.includes("serve"), "windows-mcp is a command group: `serve` is required");
  const excludeIndex = config.args.indexOf("--exclude-tools");
  assert.ok(excludeIndex >= 0 && typeof config.args[excludeIndex + 1] === "string");
  assert.equal(config.args[excludeIndex + 1], "App,PowerShell,FileSystem", "one comma-separated argv");
  assert.ok(!config.args.includes("--disable-tools"), "that flag does not exist in windows-mcp 0.8.8");
  assert.equal(config.toolCallTimeoutMs, 120_000);
  assert.equal(config.failOnStartupError, false, "a missing Windows-MCP must not fail the boot");
  assert.equal(config.reconnect?.enabled, true);
  assert.equal(config.env.ANONYMIZED_TELEMETRY, "false", "upstream telemetry is on by default");
  assert.equal(config.env.WINDOWS_MCP_DISABLE_FLASH, "1");
  assert.equal(config.env.WINDOWS_MCP_SCREENSHOT_SCALE, "0.75");
});

test("bridge config never names tools upstream refuses to exclude", () => {
  assert.ok(
    !/--exclude-tools[\s\S]{0,120}ControlStatus/u.test(patchText.replace(/\r\n/gu, "\n")),
    "ControlStatus cannot be excluded upstream — do not list it",
  );
});

/* ------------------------------------------------------------------ *
 * host half
 * ------------------------------------------------------------------ */

test("apply never throws, whatever the host context looks like", () => {
  const hostile = [
    undefined,
    {},
    { logger: () => { throw new Error("logger exploded"); } },
    { logger: () => ({ warn() { throw new Error("warn exploded"); } }) },
    { inject() { throw new Error("inject exploded"); } },
    { inject(_services, callback) { callback(undefined); } },
    { inject(_services, callback) { callback({ tools: { register() { throw new Error("register exploded"); } } }); } },
  ];
  for (const ctx of hostile) {
    assert.doesNotThrow(() => apply(ctx), `apply() must survive ctx=${JSON.stringify(ctx)}`);
  }
});

test("featured-plugins integration never breaks apply() and stays wired", () => {
  // The host half inlines the dsh-featured integration module; apply() must
  // survive a context that lets it become the featured "owner" (effect/provide
  // available), and the wiring must stay in place on both halves.
  const services = new Map();
  const effects = [];
  apply({
    logger: { warn() {} },
    get: (key) => services.get(key),
    provide: (key, value) => {
      services.set(key, value);
      return () => services.delete(key);
    },
    effect: (callback) => {
      effects.push(callback);
      return callback();
    },
    inject(_services, callback) {
      callback({
        tools: { register() { return () => {}; } },
        webServer: { register() { return () => {}; } },
      });
    },
  });
  assert.ok(clientSource.includes("window.__DSH_FEATURED_INIT__(ctx)"), "the client half must call the featured init");
  assert.ok(clientSource.includes(">>> dsh-featured inline"), "the client half must inline the featured module");
});

test("default export exposes name and apply", () => {
  assert.equal(plugin.name, "dsh-windows-mcp");
  assert.equal(typeof plugin.apply, "function");
});

test("windows_mcp_doctor registers and produces a usable report", async () => {
  const registered = [];
  apply({
    logger: { warn() {} },
    inject(services, callback) {
      if (services.includes("tools")) {
        callback({ tools: { register(definition) { registered.push(definition); return () => {}; } } });
        return;
      }
      callback({ webServer: { register() { return () => {}; } }, get: () => undefined });
    },
  });

  assert.equal(registered.length, 2, "the doctor and the lazy-tool entry are both registered");
  const definition = registered.find((candidate) => candidate.name === "windows_mcp_doctor");
  assert.ok(definition, "the doctor is registered");
  assert.equal(definition.name, "windows_mcp_doctor");
  assert.equal(typeof definition.execute, "function");
  assert.equal(definition.parameters.additionalProperties, false);

  const output = await definition.execute({});
  assert.match(output.report, /desktop probe\s+:/, "the report separates live UI Automation health from the file checks");
  assert.equal(typeof output.report, "string");
  assert.match(output.report, /dsh-windows-mcp \d+\.\d+\.\d+/);
  assert.match(output.report, /uvx\s+:/);
  assert.match(output.report, /windows-mcp-bridge/);
  assert.match(output.report, /computer use\s+:/);
  assert.match(output.report, /lazy tools\s+:/);
  assert.match(output.report, /verdict {2,}:/);

  const blocks = definition.output.render({}, output);
  assert.ok(Array.isArray(blocks));
  assert.equal(blocks[0].type, "text");
  assert.equal(blocks[0].text, output.report);
  assert.deepEqual(Object.keys(definition.output.schema.properties), ["report"]);
});

test("the host registers the Computer Use state route and answers GET", async () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-windows-mcp-state-"));
  process.env.DSH_HOME = home;
  // A fresh module instance (cache-busted) picks up the temporary DSH_HOME.
  const fresh = await import(`../lib/index.js?state-route=${Date.now()}`);

  const routes = new Map();
  const tools = { schemas: () => [["mcp__windows__Screenshot", {}], ["bash", {}], ["mcp__windows__Click", {}]] };
  fresh.apply({
    logger: { warn() {} },
    inject(services, callback) {
      if (services.includes("webServer")) {
        callback({
          webServer: { register(candidate) { routes.set(candidate.path, candidate); return () => {}; } },
          get: (key) => (key === "tools" ? tools : undefined),
        });
        return;
      }
      callback({ tools: { register() { return () => {}; }, guard() { return () => {}; } } });
    },
  });

  const route = routes.get("/dsh-windows-mcp/state");
  assert.ok(route, "the state route must be registered");
  assert.equal(route.kind, "exact");
  assert.equal(route.path, "/dsh-windows-mcp/state");
  assert.ok(routes.has("/dsh-windows-mcp/prepare"), "the install route must be registered");
  assert.ok(routes.has("/dsh-windows-mcp/prepare/cancel"));
  assert.ok(routes.has("/dsh-windows-mcp/bridge"));

  // A read that names no session is the Settings page, which is not a
  // conversation: there is no host-wide switch left to report.
  const get = fakeResponse();
  route.handler({ method: "GET" }, get);
  assert.equal(get.status, 200);
  const body = JSON.parse(get.body);
  assert.equal(body.enabled, null, "no session named, no grant to report");
  assert.equal(body.scope, "session");
  assert.equal(body.sessionId, null);
  assert.equal(body.bridged, 2, "counts only the bridged tools");
  assert.equal(body.serverName, "windows");
  assert.equal(typeof body.dependency, "object", "the page reads dependency status from the same route");
  assert.equal(typeof body.dependency.installed, "boolean");
  assert.equal(body.prepare.phase, "idle", "nothing is installing yet");
  assert.equal(body.update.versions.updateAvailable, false, "no managed slot must not mean an update is waiting");

  // A write has to name the session it speaks for: a host-wide write is exactly
  // the behaviour this route no longer offers.
  const anonymous = fakeResponse();
  route.handler(fakeRequest("POST", '{"enabled":true}'), anonymous);
  assert.equal(anonymous.status, 400);
  assert.match(JSON.parse(anonymous.body).error, /sessionId/u);

  const post = fakeResponse();
  route.handler(fakeRequest("POST", '{"enabled":true,"sessionId":"session-1"}'), post);
  assert.equal(post.status, 200);
  assert.equal(JSON.parse(post.body).enabled, true);
  assert.equal(JSON.parse(post.body).sessionId, "session-1");
  assert.ok(
    !existsSync(join(home, "dsh-windows-mcp.state.json")),
    "a grant is never written to disk: a file a model can write is not a place to keep it",
  );

  const readBack = fakeResponse();
  route.handler({ method: "GET", url: "/dsh-windows-mcp/state?sessionId=session-1" }, readBack);
  assert.equal(JSON.parse(readBack.body).enabled, true, "the session's own grant is what the pill reads");
  assert.equal(JSON.parse(readBack.body).desktopTools.revealTool, "windows_desktop");

  const bad = fakeResponse();
  route.handler(fakeRequest("POST", '{"enabled":"yes","sessionId":"session-1"}'), bad);
  assert.equal(bad.status, 400);

  // Every half-formed write is refused rather than applied to the wrong session.
  for (const body of ['{"sessionId":"session-1"}', '{"enabled":true}', '{"enabled":true,"sessionId":""}', '{"enabled":true,"sessionId":7}']) {
    const refusedBody = fakeResponse();
    route.handler(fakeRequest("POST", body), refusedBody);
    assert.equal(refusedBody.status, 400, `${body} must be refused`);
    assert.match(JSON.parse(refusedBody.body).error, /sessionId/u);
  }

  // A session id is opaque, but a page cannot use it to grow the map without
  // bound: what is stored is the first 128 characters, exactly like the read.
  const longId = "x".repeat(200);
  const longWrite = fakeResponse();
  route.handler(fakeRequest("POST", JSON.stringify({ enabled: true, sessionId: longId })), longWrite);
  assert.equal(longWrite.status, 200);
  assert.equal(JSON.parse(longWrite.body).sessionId.length, 128);

  const wrongMethod = fakeResponse();
  route.handler({ method: "DELETE" }, wrongMethod);
  assert.equal(wrongMethod.status, 405);
});

test("an update is only announced over the version actually in use", async () => {
  const { updateAvailability } = await import("../lib/updater.js");
  assert.equal(updateAvailability("0.8.8", "0.8.8"), false, "the running build is already the latest");
  assert.equal(updateAvailability("0.8.8", "0.8.7"), true);
  assert.equal(updateAvailability("0.8.8", null), false, "nothing installed is not an update waiting");
  assert.equal(updateAvailability(null, "0.8.8"), false, "no check has run yet");
});

test("a mutation without the GUI session cookie is refused", async () => {
  // The switch used to be a plain POST away for anything that could reach
  // 127.0.0.1 — including the agent itself through a shell. The Host's
  // Connection service mints a signed cookie only through the launch-token
  // exchange, so the routes now demand it for every POST.
  const home = mkdtempSync(join(tmpdir(), "dsh-windows-mcp-auth-"));
  process.env.DSH_HOME = home;
  const fresh = await import(`../lib/index.js?auth-route=${Date.now()}`);

  const routes = new Map();
  const makeCtx = (authenticated) => ({
    logger: { warn() {} },
    inject(services, callback) {
      if (services.includes("webServer")) {
        callback({
          webServer: { register(candidate) { routes.set(candidate.path, candidate); return () => {}; }, protocol: "http:" },
          get: (key) => {
            if (key === "tools") return { schemas: () => [] };
            if (key === "webServer") return { protocol: "http:" };
            if (key === "connection") return { browserAuth: { isAuthenticated: () => authenticated } };
            return undefined;
          },
        });
        return;
      }
      callback({ tools: { register() { return () => {}; }, guard() { return () => {}; } } });
    },
  });

  fresh.apply(makeCtx(false));
  const route = routes.get("/dsh-windows-mcp/state");
  assert.ok(route, "the state route must be registered");

  const read = fakeResponse();
  route.handler({ method: "GET" }, read);
  assert.equal(read.status, 200, "reads stay open so the page can render before any decision");

  const refused = fakeResponse();
  route.handler(fakeRequest("POST", '{"enabled":true,"sessionId":"session-1"}'), refused);
  assert.equal(refused.status, 401, "no cookie, no switch");
  const refusal = JSON.parse(refused.body);
  assert.match(refusal.error, /DSH window/u);
  const afterRefusal = fakeResponse();
  route.handler({ method: "GET", url: "/dsh-windows-mcp/state?sessionId=session-1" }, afterRefusal);
  assert.equal(JSON.parse(afterRefusal.body).enabled, false, "a refused write grants nothing");

  const settingsRefused = fakeResponse();
  routes.get("/dsh-windows-mcp/settings").handler(fakeRequest("POST", '{"settings":{}}'), settingsRefused);
  assert.equal(settingsRefused.status, 401, "settings writes are gated too");

  // Same routes, same body, now with the browser's cookie: allowed.
  routes.clear();
  fresh.apply(makeCtx(true));
  const accepted = fakeResponse();
  routes.get("/dsh-windows-mcp/state").handler(fakeRequest("POST", '{"enabled":true,"sessionId":"session-1"}'), accepted);
  assert.equal(accepted.status, 200);
  assert.equal(JSON.parse(accepted.body).enabled, true);
});

test("lazy tools reveal the desktop capabilities only on demand", async () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-windows-mcp-lazy-"));
  process.env.DSH_HOME = home;
  const fresh = await import(`../lib/index.js?lazy=${Date.now()}`);

  const routes = new Map();
  const events = new Map();
  let guard = null;
  const registered = [];
  const restricted = new Map();
  let catalog = [
    ["mcp__windows__Screenshot", { description: "Take a screenshot", parameters: { type: "object", properties: {} } }],
    ["mcp__windows__Click", { description: "Click a point", parameters: { type: "object", properties: { loc: { type: "array" } } } }],
    ["windows_desktop", {}],
  ];
  const tools = {
    schemas: () => catalog,
    register(definition) {
      registered.push(definition);
      return () => {};
    },
    guard(candidate) {
      guard = candidate;
      return () => {};
    },
  };
  // The host hands `system-prompt/assemble` only `{ sections, contexts,
  // variables }` and merges `tools` in afterwards, so the gate has to work
  // through the agent-scoped tools service instead. Every lifecycle event
  // carries the agent as `payload.agent`, never as the payload itself.
  const agentFor = (id) => ({
    id,
    ctx: {
      get: (key) => (key === "tools" ? {
        schemas: () => tools.schemas(),
        restrict(filter) {
          restricted.set(id, filter.deny ?? []);
          return () => restricted.delete(id);
        },
      } : undefined),
    },
  });
  fresh.apply({
    logger: { warn() {} },
    on(event, listener) {
      events.set(event, listener);
    },
    inject(services, callback) {
      if (services.includes("webServer")) {
        callback({
          webServer: { register(candidate) { routes.set(candidate.path, candidate); return () => {}; } },
          get: () => undefined,
        });
        return;
      }
      callback({ tools });
    },
  });

  const reveal = registered.find((definition) => definition.name === "windows_desktop");
  assert.ok(reveal, "the reveal entry is registered as a normal tool");
  assert.equal(typeof reveal.execute, "function");
  assert.equal(typeof reveal.output.render, "function", "the reveal result is rendered for the transcript");

  // The grant is per session, so this scenario grants the two conversations it
  // is about — the reveal state, not the switch, is what differs between them.
  for (const sessionId of ["alice", "bob"]) {
    const enabled = fakeResponse();
    routes.get("/dsh-windows-mcp/state").handler(fakeRequest("POST", JSON.stringify({ enabled: true, sessionId })), enabled);
    assert.equal(enabled.status, 200);
    assert.equal(JSON.parse(enabled.body).enabled, true);
  }

  const preStep = events.get("agent/pre-step");
  const created = events.get("agent/created");
  assert.equal(typeof preStep, "function", "the agent step must stay hooked as a safety net");
  assert.equal(typeof created, "function", "a created agent must be restricted before its first step");

  const alice = agentFor("alice");
  const bob = agentFor("bob");

  created({ agent: alice, source: "user" });
  assert.deepEqual(
    restricted.get("alice"),
    ["mcp__windows__Screenshot", "mcp__windows__Click"],
    "the eighteen schemas stay out of the prompt",
  );
  assert.match(guard({ name: "mcp__windows__Click", agent: alice }) ?? "", /hidden to save context/u);

  const revealedAll = reveal.execute({}, { agent: alice });
  assert.deepEqual([...revealedAll.revealed].sort(), ["mcp__windows__Click", "mcp__windows__Screenshot"]);
  assert.equal(revealedAll.tools.length, 2);
  assert.match(String(revealedAll.note), /next step/u);

  // The reveal executes inside the step; the tool set is resolved before
  // `agent/pre-step`, so the restriction must drop right here rather than wait
  // for the next step.
  assert.equal(restricted.has("alice"), false, "the revealed capabilities join the next step");
  assert.equal(guard({ name: "mcp__windows__Click", agent: alice }), undefined, "revealed tools dispatch again");

  preStep({ agent: bob, messages: [], signal: undefined });
  assert.deepEqual(
    restricted.get("bob"),
    ["mcp__windows__Screenshot", "mcp__windows__Click"],
    "another agent stays dark",
  );
  assert.match(guard({ name: "mcp__windows__Click", agent: bob }) ?? "", /hidden/u);

  const clickOnly = reveal.execute({ query: "click" }, { agent: bob });
  assert.deepEqual(clickOnly.revealed, ["mcp__windows__Click"], "a keyword reveals only what it matches");
  assert.deepEqual(restricted.get("bob"), ["mcp__windows__Screenshot"], "only the unrevealed name stays hidden");

  // The bridge registers its tools after the agent exists; a late registration
  // must reach the restriction too.
  catalog = [...catalog, ["mcp__windows__Scroll", {}]];
  events.get("tools/change")();
  assert.deepEqual(
    [...restricted.get("bob")].sort(),
    ["mcp__windows__Screenshot", "mcp__windows__Scroll"],
    "a tool registered after the agent is hidden as well",
  );

  const rendered = reveal.output.render({}, revealedAll);
  assert.match(rendered.map((part) => part.text).join("\n"), /Revealed 2 desktop capability/u);

  const disabled = fakeResponse();
  routes.get("/dsh-windows-mcp/state").handler(fakeRequest("POST", '{"enabled":false,"sessionId":"alice"}'), disabled);
  assert.equal(disabled.status, 200);
  assert.deepEqual(
    [...restricted.get("alice")].sort(),
    ["mcp__windows__Click", "mcp__windows__Screenshot", "mcp__windows__Scroll", "windows_desktop"],
    "switching off hides everything immediately, without waiting for a step",
  );
  const refused = reveal.execute({}, { agent: alice });
  assert.deepEqual(refused.revealed, []);
  assert.match(String(refused.note), /switched off/u);
  assert.deepEqual(
    [...restricted.get("bob")].sort(),
    ["mcp__windows__Screenshot", "mcp__windows__Scroll"],
    "the other session keeps the grant it was given, unaffected by this revocation",
  );
});


test("the Computer Use switch truly hides the bridged tools and refuses them", async () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-windows-mcp-gate-"));
  process.env.DSH_HOME = home;
  const fresh = await import(`../lib/index.js?gate=${Date.now()}`);

  const routes = new Map();
  const events = new Map();
  let guard = null;
  const restricted = new Map();
  const catalog = [
    ["mcp__windows__Screenshot", {}],
    ["mcp__windows__Click", {}],
    ["windows_desktop", {}],
    ["bash", {}],
  ];
  const tools = {
    schemas: () => catalog,
    register() { return () => {}; },
    guard(candidate) { guard = candidate; return () => {}; },
  };
  const agent = {
    id: "gate",
    ctx: {
      get: (key) => (key === "tools" ? {
        schemas: () => tools.schemas(),
        restrict(filter) {
          restricted.set("gate", filter.deny ?? []);
          return () => restricted.delete("gate");
        },
      } : undefined),
    },
  };
  fresh.apply({
    logger: { warn() {} },
    on(event, listener) {
      events.set(event, listener);
    },
    inject(services, callback) {
      if (services.includes("webServer")) {
        callback({
          webServer: { register(candidate) { routes.set(candidate.path, candidate); return () => {}; } },
          get: (key) => (key === "tools" ? tools : undefined),
        });
        return;
      }
      callback({ tools });
    },
  });

  const preStep = events.get("agent/pre-step");
  assert.equal(typeof preStep, "function", "the agent step must be hooked, not prompt assembly");
  assert.equal(typeof guard, "function", "a dispatch guard must be installed");

  // Default OFF: the desktop is hidden and refused from the very first step,
  // including the reveal entry — turning the desktop off turns everything off.
  preStep({ agent, messages: [], signal: undefined });
  assert.deepEqual(
    restricted.get("gate"),
    ["mcp__windows__Screenshot", "mcp__windows__Click", "windows_desktop"],
    "desktop tools vanish from the model-facing list",
  );
  assert.match(guard({ name: "mcp__windows__Click", agent }) ?? "", /Computer Use is switched off/u);
  assert.match(
    guard({ name: "mcp__windows__Click" }) ?? "",
    /switched off for this session/u,
    "a call with no session behind it fails closed instead of inheriting someone else's grant",
  );
  assert.equal(guard({ name: "bash" }), undefined, "unrelated tools keep working");

  // Flip the switch the way the pill does: the reveal entry appears, the
  // eighteen schemas still do not, and dispatch refuses until they are revealed.
  const post = fakeResponse();
  routes.get("/dsh-windows-mcp/state").handler(fakeRequest("POST", '{"enabled":true,"sessionId":"gate"}'), post);
  assert.equal(post.status, 200);

  assert.deepEqual(
    restricted.get("gate"),
    ["mcp__windows__Screenshot", "mcp__windows__Click"],
    "an enabled desktop offers the reveal entry instead of the whole table, on the very next request",
  );
  assert.match(guard({ name: "mcp__windows__Click", agent }) ?? "", /hidden to save context/u);
  assert.equal(guard({ name: "bash", agent }), undefined, "unrelated tools keep working");
});

/**
 * The harness the per-session tests share: fake agents with their own tool
 * scopes, a catalog that includes the reveal entry, and the routes the pill
 * talks to.
 * @param tag - cache-busting tag, so every test gets a fresh module instance.
 * @param options.sessions - optional session ids → live sessions, exposed as the
 *   host's `sessions` service so the plugin can walk a subagent's lineage.
 */
async function sessionHarness(tag, options = {}) {
  const home = mkdtempSync(join(tmpdir(), `dsh-windows-mcp-${tag}-`));
  process.env.DSH_HOME = home;
  const fresh = await import(`../lib/index.js?${tag}=${Date.now()}`);

  const routes = new Map();
  const events = new Map();
  const restricted = new Map();
  const state = { guard: null };
  const sessions = options.sessions ?? null;
  const catalog = [["mcp__windows__Screenshot", {}], ["mcp__windows__Click", {}], ["windows_desktop", {}], ["bash", {}]];
  const tools = {
    schemas: () => catalog,
    register() { return () => {}; },
    guard(candidate) { state.guard = candidate; return () => {}; },
  };
  const agentFor = (id, header = { id }) => ({
    id,
    session: { id, header },
    ctx: {
      get: (key) => (key === "tools" ? {
        schemas: () => tools.schemas(),
        restrict(filter) {
          restricted.set(id, filter.deny ?? []);
          return () => restricted.delete(id);
        },
      } : undefined),
    },
  });

  fresh.apply({
    logger: { warn() {} },
    get(key) {
      if (key === "sessions") return sessions === null ? undefined : { get: (id) => sessions.get(id) };
      if (key === "tools") return tools;
      return undefined;
    },
    on(event, listener) { events.set(event, listener); },
    inject(services, callback) {
      if (services.includes("webServer")) {
        callback({
          webServer: { register(candidate) { routes.set(candidate.path, candidate); return () => {}; } },
          get: (key) => (key === "tools" ? tools : undefined),
        });
        return;
      }
      callback({ tools });
    },
  });

  const route = routes.get("/dsh-windows-mcp/state");
  assert.ok(route, "the state route must be registered");
  const read = (sessionId) => {
    const response = fakeResponse();
    route.handler({ method: "GET", url: `/dsh-windows-mcp/state?sessionId=${encodeURIComponent(sessionId)}` }, response);
    assert.equal(response.status, 200);
    return JSON.parse(response.body);
  };
  const write = (sessionId, enabled) => {
    const response = fakeResponse();
    route.handler(fakeRequest("POST", JSON.stringify({ enabled, sessionId })), response);
    assert.equal(response.status, 200, response.body);
    return JSON.parse(response.body);
  };
  const created = (agent) => events.get("agent/created")({ agent, source: "user" });
  /** Write one `plugin` settings object the way the Settings page does. */
  const saveSettings = (plugin) => {
    const response = fakeResponse();
    routes.get("/dsh-windows-mcp/settings").handler(fakeRequest("POST", JSON.stringify({ settings: { plugin } })), response);
    assert.equal(response.status, 200, response.body);
    return JSON.parse(response.body);
  };

  return { home, fresh, routes, events, restricted, tools, agentFor, read, write, created, saveSettings, state };
}

test("the Computer Use switch belongs to one conversation, not to the host", async () => {
  // One host-wide flag meant the pill in one window silently moved every other
  // window: a grant handed the desktop to sessions that never asked for it, and
  // a revocation blinded a session in the middle of a task.
  const harness = await sessionHarness("sessions");
  const { read, write, created, restricted, state } = harness;
  const alice = harness.agentFor("alice");
  const bob = harness.agentFor("bob");

  assert.equal(read("alice").enabled, false, "every conversation starts blind");
  assert.equal(read("bob").enabled, false);
  assert.equal(read("alice").scope, "session", "the route states its scope instead of implying a global switch");

  write("alice", true);
  assert.equal(read("alice").enabled, true);
  assert.equal(read("bob").enabled, false, "a grant in one conversation never reaches another");

  created(alice);
  created(bob);
  assert.deepEqual(
    restricted.get("alice"),
    ["mcp__windows__Screenshot", "mcp__windows__Click"],
    "the granted session offers the reveal entry instead of the whole table",
  );
  assert.deepEqual(
    restricted.get("bob"),
    ["mcp__windows__Screenshot", "mcp__windows__Click", "windows_desktop"],
    "the ungranted session has nothing to offer, not even the entry",
  );
  assert.match(state.guard({ name: "mcp__windows__Click", agent: bob }) ?? "", /switched off for this session/u);
  assert.match(state.guard({ name: "mcp__windows__Click", agent: alice }) ?? "", /hidden to save context/u);

  // Revoking one side must not disarm the other. This is the case the old flag
  // got wrong while two windows were working at the same time.
  write("alice", false);
  write("bob", true);
  assert.equal(read("alice").enabled, false);
  assert.equal(read("bob").enabled, true, "the other conversation keeps the grant it was given");
  assert.deepEqual(
    [...restricted.get("alice")].sort(),
    ["mcp__windows__Click", "mcp__windows__Screenshot", "windows_desktop"],
    "the revoked session goes dark on its own, without waiting for a step",
  );
  assert.deepEqual(
    [...restricted.get("bob")].sort(),
    ["mcp__windows__Click", "mcp__windows__Screenshot"],
    "the session that still holds the grant keeps its tools",
  );
});

test("a session that never decided follows the settings default, and the pill still overrides it", async () => {
  // The Settings page owns the *fallback* a conversation starts with; the pill
  // owns the conversation itself. Keeping the two apart is what lets someone opt
  // into "desktop by default" without turning the composer switch back into a
  // host-wide lever.
  const harness = await sessionHarness("default-grant");
  const { read, write, created, restricted, saveSettings, state } = harness;

  assert.equal(read("fresh").enabled, false, "the default ships off: a new install grants nothing");

  // Settings → Desktop → Tool exposure → grant new sessions by default.
  saveSettings({ defaultGrant: true });
  assert.equal(read("fresh").enabled, true, "an undecided conversation follows the default");
  assert.equal(read("fresh").desktopTools.revealTool, "windows_desktop", "the reveal entry comes with it");

  const undecided = harness.agentFor("undecided");
  const decided = harness.agentFor("decided");
  write("decided", false);
  created(undecided);
  created(decided);
  assert.deepEqual(
    restricted.get("undecided"),
    ["mcp__windows__Screenshot", "mcp__windows__Click"],
    "the default grant reaches the tool list of a session that never touched the pill",
  );
  assert.deepEqual(
    restricted.get("decided"),
    ["mcp__windows__Screenshot", "mcp__windows__Click", "windows_desktop"],
    "an explicit decision outranks the default",
  );
  assert.match(state.guard({ name: "mcp__windows__Click", agent: decided }) ?? "", /switched off for this session/u);

  // Flipping the default back must move only the sessions that never decided.
  write("decided", true);
  saveSettings({ defaultGrant: false });
  assert.equal(read("undecided").enabled, false, "undecided conversations follow the default back down");
  assert.equal(read("decided").enabled, true, "a session that decided for itself keeps its grant");
  assert.deepEqual(
    [...restricted.get("undecided")].sort(),
    ["mcp__windows__Click", "mcp__windows__Screenshot", "windows_desktop"],
    "the setting change is applied to live agents without waiting for a step",
  );
  assert.deepEqual(
    [...restricted.get("decided")].sort(),
    ["mcp__windows__Click", "mcp__windows__Screenshot"],
    "the session with its own grant is untouched by that change",
  );
});

test("a subagent inherits its parent's grant, a forked conversation does not", async () => {
  // The host puts a child session's lineage in its header: a subagent names the
  // conversation that spawned it, a forked or resumed chat names the session it
  // branched from but nobody is delegating on its behalf.
  const sessions = new Map([
    ["parent", { id: "parent", header: { id: "parent" } }],
    ["child", { id: "child", header: { id: "child", origin: "subagent", parentSession: "parent" } }],
    ["fork", { id: "fork", header: { id: "fork", parentSession: "parent" } }],
  ]);
  const harness = await sessionHarness("lineage", { sessions });
  const { read, write, created, restricted, state } = harness;

  const parent = harness.agentFor("parent");
  const child = harness.agentFor("child", sessions.get("child").header);
  const fork = harness.agentFor("fork", sessions.get("fork").header);

  write("parent", true);
  created(parent);
  created(child);
  created(fork);

  assert.deepEqual(
    restricted.get("parent"),
    ["mcp__windows__Screenshot", "mcp__windows__Click"],
    "the granted session holds the desktop",
  );
  assert.deepEqual(
    restricted.get("child"),
    ["mcp__windows__Screenshot", "mcp__windows__Click"],
    "a subagent works on behalf of its parent's conversation, so it inherits the grant",
  );
  assert.deepEqual(
    restricted.get("fork"),
    ["mcp__windows__Screenshot", "mcp__windows__Click", "windows_desktop"],
    "a forked chat is a new conversation a human drives: it starts blind",
  );
  assert.match(state.guard({ name: "mcp__windows__Click", agent: fork }) ?? "", /switched off for this session/u);

  // The nearest explicit decision wins, so a subagent can revoke what it
  // inherited without touching the parent's switch.
  write("child", false);
  assert.deepEqual(
    [...restricted.get("child")].sort(),
    ["mcp__windows__Click", "mcp__windows__Screenshot", "windows_desktop"],
    "an explicit revocation on the child overrides the inherited grant",
  );
  assert.equal(read("parent").enabled, true, "the parent's own switch is untouched");
});

test("the tool gate hands the step waterfall back and never recurses", async () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-windows-mcp-waterfall-"));
  process.env.DSH_HOME = home;
  const fresh = await import(`../lib/index.js?waterfall=${Date.now()}`);

  const routes = new Map();
  const events = new Map();
  const registered = [];
  let restrictCalls = 0;
  let disposed = 0;
  let restricted = null;
  const catalog = [
    ["mcp__windows__Screenshot", {}],
    ["mcp__windows__Click", {}],
    ["windows_desktop", {}],
    ["bash", {}],
  ];

  // The real tools service emits `tools/change` synchronously from inside
  // `restrict()` (ScopedLayers.effect); the fake must do the same, otherwise a
  // self-triggered recursion stays invisible to the test.
  const announceChange = () => {
    const listener = events.get("tools/change");
    if (typeof listener === "function") listener();
  };

  const tools = {
    schemas: () => catalog,
    register(definition) { registered.push(definition); return () => {}; },
    guard() { return () => {}; },
    restrict(filter) {
      restrictCalls += 1;
      restricted = filter.deny ?? [];
      announceChange();
      return () => { disposed += 1; };
    },
  };
  const agent = { id: "waterfall", ctx: { get: (key) => (key === "tools" ? tools : undefined) } };

  fresh.apply({
    logger: { warn() {} },
    on(event, listener) { events.set(event, listener); },
    inject(services, callback) {
      if (services.includes("webServer")) {
        callback({
          webServer: { register(candidate) { routes.set(candidate.path, candidate); return () => {}; } },
          get: (key) => (key === "tools" ? tools : key === "agents" ? { list: () => [agent] } : undefined),
        });
        return;
      }
      callback({ tools });
    },
  });

  events.get("agent/created")({ agent, source: "user" });
  assert.equal(restrictCalls, 1, "one decision change registers one restriction, not a recursive stack");
  assert.deepEqual(
    restricted,
    ["mcp__windows__Screenshot", "mcp__windows__Click", "windows_desktop"],
    "the desktop starts hidden",
  );

  // The host dispatches `agent/pre-step` as a Cordis waterfall and reads
  // `decision.kind`; a listener that keeps the chain to itself kills the turn
  // before it starts. The built-in decision must come back untouched.
  const preStep = events.get("agent/pre-step");
  let nextCalls = 0;
  const decision = await preStep({ agent, messages: [], signal: undefined }, () => {
    nextCalls += 1;
    return Promise.resolve({ kind: "enter", messages: [] });
  });
  assert.equal(nextCalls, 1, "the built-in step decision must be reached");
  assert.equal(decision?.kind, "enter", "the waterfall result is preserved");

  // Same step, same decision: nothing is re-registered.
  await preStep({ agent, messages: [], signal: undefined }, () => Promise.resolve({ kind: "enter", messages: [] }));
  assert.equal(restrictCalls, 1);

  // Enabling the switch relaxes the restriction; the old handle must be
  // released instead of stacking another deny mask on the agent scope.
  const enabled = fakeResponse();
  routes.get("/dsh-windows-mcp/state").handler(fakeRequest("POST", '{"enabled":true,"sessionId":"waterfall"}'), enabled);
  assert.equal(enabled.status, 200);
  assert.equal(disposed, 1, "the previous restriction is released");
  assert.equal(restrictCalls, 2, "the relaxed decision registers exactly one new layer");
  assert.deepEqual(restricted, ["mcp__windows__Screenshot", "mcp__windows__Click"]);

  // Revealing everything empties the deny list: the layer is disposed, never
  // replaced by an empty restrict() the host may reject.
  const reveal = registered.find((definition) => definition.name === "windows_desktop");
  reveal.execute({}, { agent });
  assert.equal(restrictCalls, 2, "an empty deny list registers nothing");
  assert.equal(disposed, 2, "the empty decision still removes the old layer");
});

test("disposing the registered tool does not throw", () => {
  assert.doesNotThrow(() => {
    apply({
      logger: { warn() {} },
      inject(_services, callback) {
        callback({
          tools: { register() { return () => {}; } },
          webServer: { register() { return () => {}; } },
          get: () => undefined,
          on() {},
        });
      },
    });
  });
});

/* ------------------------------------------------------------------ *
 * client half
 * ------------------------------------------------------------------ */

/** Evaluate the client bundle with a stubbed module loader and React. */
function loadClientBundle(language = "en-US") {
  let spec = null;
  const windowStub = {
    __ModuleLoader__: { load(candidate) { spec = candidate; } },
    navigator: { language },
  };
  // eslint-disable-next-line no-new-func -- the bundle is a plain CJS factory
  new Function("window", clientSource)(windowStub);
  assert.ok(spec, "the bundle must call __ModuleLoader__.load");

  const elements = [];
  const reactStub = {
    // React flattens arrays and drops empty children; the stub must too, or a
    // panel that passes an array of rows looks empty to the assertions below.
    useRef(initial) {
      return { current: initial };
    },
    createElement(type, props, ...children) {
      const flat = [];
      const push = (value) => {
        if (Array.isArray(value)) {
          for (const item of value) push(item);
          return;
        }
        if (value === null || value === undefined || value === false || value === true) return;
        flat.push(value);
      };
      for (const child of children) push(child);
      const element = { type, props: props ?? {}, children: flat };
      elements.push(element);
      return element;
    },
    useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
    // Effects run inline: the assertions below check the subscriptions the
    // components register on mount, which the real React also runs.
    useEffect(effect) { return effect(); },
    useCallback(callback) { return callback; },
  };
  const exportsObject = spec.factory((name) => {
    if (name === "react") return reactStub;
    throw new Error(`unexpected require: ${name}`);
  });
  return { spec, exportsObject, elements };
}

/** Register the client bundle against a fake context and render the pill. */
function mountPill(exportsObject, extras = {}) {
  const registrations = [];
  const ctx = Object.assign(
    {
      slots: {
        inject(_name, callback) { callback(); },
        register(meta, component) { registrations.push({ meta, component }); return { meta, component }; },
      },
    },
    extras,
  );
  exportsObject.apply(ctx);
  const registration = registrations.find((entry) => entry.meta.name === "conversation.input.left");
  assert.ok(registration, "the composer pill must be registered");
  const wrapper = registration.component({ sessionId: "session-1" });
  const cell = wrapper.type(wrapper.props);
  const pillElement = cell.children[0];
  return { ctx, registrations, pill: pillElement.type(pillElement.props) };
}

test("client bundle declares its id, slot and inject list", () => {
  const { spec, exportsObject } = loadClientBundle();
  assert.equal(spec.id, "dsh-windows-mcp");
  assert.equal(typeof exportsObject.apply, "function");
  assert.deepEqual(exportsObject.inject, ["slots"], "only inject the slot service");
  assert.equal(typeof exportsObject.__internals.copy, "function");
  assert.equal(exportsObject.__internals.copy().pillLabel, "Computer Use", "English is the fallback");
  assert.equal(exportsObject.__internals.apiUrl("/dsh-windows-mcp/state"), "/dsh-windows-mcp/state");
});

test("client bundle registers the composer pill and the Plugins-page slots", () => {
  const { exportsObject } = loadClientBundle();
  const injected = [];
  const registrations = [];
  exportsObject.apply({
    slots: {
      inject(name, callback) { injected.push(name); callback(); },
      register(meta, component) { registrations.push({ meta, component }); return { meta, component }; },
    },
  });

  const pill = registrations.find((entry) => entry.meta.name === "conversation.input.left");
  assert.ok(pill, "the composer pill must be registered");
  assert.equal(pill.meta.id, "windows-mcp-computer-use");
  assert.equal(typeof pill.meta.order, "number");
  assert.equal(typeof pill.meta.label(), "string");
  assert.equal(typeof pill.component, "function");

  for (const slot of ["plugins.bundle.config", "plugins.bundle.activation"]) {
    const entry = registrations.find((candidate) => candidate.meta.name === slot);
    assert.ok(entry, `${slot} must be registered`);
    assert.equal(entry.meta.key, "dsh-windows-mcp", `${slot} is keyed by the bundle package name`);
    assert.equal(typeof entry.component, "function");
    assert.ok(injected.includes(slot), `${slot} must be declared through slots.inject`);
  }
});

test("the pill re-reads the host flag instead of freezing its first render", () => {
  // The switch used to fetch /state once on mount, so a flag changed by the
  // settings page, an installer run or another window left the pill showing a
  // stale position. It now refreshes on a timer and when the window regains
  // focus, and stays quiet while its own write is in flight.
  assert.ok(clientSource.includes("window.setInterval(refresh, 4000)"), "the pill polls the host flag");
  assert.ok(clientSource.includes('window.addEventListener("focus", refresh)'), "the pill resyncs on focus");
  assert.ok(clientSource.includes('window.removeEventListener("focus", refresh)'), "the listener is released on unmount");
  assert.ok(clientSource.includes("if (!busyRef.current) load();"), "the poller never overwrites an in-flight write");
  assert.ok(clientSource.includes("busyRef.current = false;"), "every settle path clears the in-flight flag");
});

test("the pill asks about its own session, never about the host", async () => {
  // The slot hands every session-scoped entry the conversation it is drawn in.
  // The pill has to use it in both directions: reading one conversation's grant
  // and writing that same conversation back.
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET", body: init && init.body });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: false, bridged: 2, scope: "session" }) });
  };
  try {
    const { exportsObject } = loadClientBundle();
    const mounted = mountPill(exportsObject);
    assert.equal(typeof mounted.pill.props.onClick, "function");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    calls.map((call) => call.url),
    ["/dsh-windows-mcp/state?sessionId=session-1"],
    "the read names the conversation the cell is drawn in",
  );
  assert.match(
    clientSource,
    /JSON\.stringify\(\{ enabled: next, sessionId: sessionId \}\)/u,
    "the write names that same conversation, so the host never has to guess",
  );
});

test("the pill is an accessible switch", () => {
  const { exportsObject } = loadClientBundle();
  const registrations = [];
  exportsObject.apply({
    slots: {
      inject(_name, callback) { callback(); },
      register(meta, component) { registrations.push({ meta, component }); return { meta, component }; },
    },
  });

  const registration = registrations.find((entry) => entry.meta.name === "conversation.input.left");
  const wrapper = registration.component({ sessionId: "session-1" });
  const cell = wrapper.type(wrapper.props);
  assert.equal(cell.type, "div", "the cell wraps the pill so it can also host the dialog");
  assert.equal(cell.props.className, "dwmc-host");
  const pillElement = cell.children[0];
  const pill = pillElement.type(pillElement.props);
  assert.equal(pill.type, "button");
  assert.equal(pill.props.role, "switch");
  assert.equal(pill.props.className, "dwmc-pill");
  assert.equal(pill.props["aria-checked"], false, "defaults to off while loading");
  assert.equal(pill.props["data-state"], "off");
  assert.equal(typeof pill.props.title, "string");
  assert.ok(pill.props.title.includes("Computer Use"));
  assert.equal(typeof pill.props.onClick, "function");
});

test("the pill and its status copy are Chinese when the host prefers it", () => {
  const { exportsObject } = loadClientBundle("en-US");
  const { pill } = mountPill(exportsObject, {
    get(name) {
      return name === "locale"
        ? { getLocale() { return { active: "zh-CN" }; } }
        : undefined;
    },
  });

  assert.equal(pill.props["aria-label"], "AI 控制电脑", "the accessible name matches the visible label");
  const label = pill.children.find((child) => child && child.props && child.props.className === "dwmc-label");
  assert.equal(label.children[0], "AI 控制电脑");
  assert.ok(pill.props.title.startsWith("正在确认控制权…"), "the status line is localized too");
  assert.ok(!pill.props.title.includes("点击切换"), "the switch affordance is the pill itself, not a line of copy");

  const tooltip = exportsObject.__internals.tooltipFor;
  assert.ok(tooltip({ phase: "ready", enabled: false, bridged: 0, busy: false, error: null }).includes("AI 未获得控制权"));
  assert.ok(
    tooltip({ phase: "ready", enabled: true, bridged: 3, busy: false, error: null }).includes("AI 正在控制这台电脑 · 本会话 3 个桌面工具已注册"),
    "the registered tool count is interpolated into the Chinese sentence, scoped to this session",
  );
  const unreachable = tooltip({ phase: "error", enabled: false, bridged: 0, busy: false, error: "boom" });
  assert.ok(unreachable.includes("无法连接宿主（boom）"));
  assert.ok(unreachable.includes("请点击重试"), "the retry line survives, because the same click now does something else");
});

test("the tooltip carries the state and the cost, not a capability list", () => {
  const { exportsObject } = loadClientBundle("en-US");
  exportsObject.apply({
    get(name) {
      return name === "locale" ? { getLocale() { return { active: "zh-CN" }; } } : undefined;
    },
    slots: {
      inject(_name, callback) { callback(); },
      register() { return {}; },
    },
  });
  const tooltip = exportsObject.__internals.tooltipFor;
  const view = { phase: "ready", busy: false, error: null };

  const off = tooltip({ ...view, enabled: false, bridged: 0 });
  assert.equal(off.split("\n").length, 1, "off is one line: the state, which already carries the consequence");
  assert.ok(off.includes("AI 未获得控制权"));
  assert.ok(!/截屏|剪贴板|注册表|进程|键盘/u.test(off), "no capability list, so there is nothing to drift out of date");
  assert.ok(!/Computer Use|agent/u.test(off), "no English product name or half-translated noun is left in the Chinese tooltip");

  const on = tooltip({ ...view, enabled: true, bridged: 18 });
  assert.deepEqual(on.split("\n"), [
    "AI 正在控制这台电脑 · 本会话 18 个桌面工具已注册",
    "关闭后，本会话的桌面工具会对模型不可见，调用会被拒绝。",
  ], "on is the state plus what turning it off would cost");

  const empty = tooltip({ ...view, enabled: true, bridged: 0 });
  assert.ok(!empty.includes("关闭后"), "a switch with nothing behind it has nothing to lose");

  const loading = tooltip({ ...view, phase: "loading", enabled: undefined });
  assert.equal(loading.split("\n").length, 1, "an unconfirmed switch reads as off");

  const unreachable = tooltip({ ...view, phase: "error", enabled: false, bridged: 0, error: "boom" });
  assert.deepEqual(unreachable.split("\n"), ["无法连接宿主（boom）", "请点击重试"]);
});

test("a language switch reaches the pill through the locale service", () => {
  const { exportsObject } = loadClientBundle("en-US");
  let active = "zh-CN";
  let listener = null;
  let unsubscribed = false;
  const { pill } = mountPill(exportsObject, {
    get(name) {
      return name === "locale"
        ? {
            getLocale() { return { active }; },
            subscribe(callback) {
              listener = callback;
              return () => { unsubscribed = true; };
            },
          }
        : undefined;
    },
  });

  assert.equal(pill.props["aria-label"], "AI 控制电脑");
  assert.equal(typeof listener, "function", "the pill subscribes so a switch repaints it at once");
  active = "en-US";
  listener();
  assert.equal(exportsObject.__internals.copy().pillLabel, "Computer Use", "the same subscription flips the copy back");
  assert.equal(unsubscribed, false, "the subscription stays live for the next switch");
});

test("the pill stays English without a locale service and follows the browser otherwise", () => {
  const english = loadClientBundle("en-US");
  assert.equal(mountPill(english.exportsObject).pill.props["aria-label"], "Computer Use");
  assert.ok(mountPill(english.exportsObject).pill.props.title.includes("Computer Use — checking…"));

  const chinese = loadClientBundle("zh-CN");
  assert.equal(mountPill(chinese.exportsObject).pill.props["aria-label"], "AI 控制电脑");

  const other = loadClientBundle("ja-JP");
  assert.equal(mountPill(other.exportsObject).pill.props["aria-label"], "Computer Use", "only Chinese is translated");
});

test("the page explains a missing uv and surfaces a refused install", () => {
  const { exportsObject } = loadClientBundle();
  const internals = exportsObject.__internals;
  assert.match(internals.UV_INSTALL_URL, /docs\.astral\.sh\/uv/u);
  assert.match(internals.UV_INSTALL_COMMAND, /astral\.sh\/uv\/install\.ps1/u);
  assert.match(internals.copy().uvHint, /uv/u);
  assert.match(clientSource, /dependency\.uv === null/u, "the hint is tied to the dependency state");
  assert.match(clientSource, /t\.uvHint/u);
  assert.match(clientSource, /UV_INSTALL_COMMAND/u);
  assert.match(clientSource, /function reasonOf/u, "a refused request keeps the host's reason");
  assert.match(clientSource, /body\.reason/u);
  assert.match(internals.CSS, /\.dwmc-note a\{/u);
});

test("the plugin card points at the settings page instead of duplicating the installer", () => {
  const { exportsObject } = loadClientBundle();
  const registrations = [];
  exportsObject.apply({
    slots: {
      inject(_name, callback) { callback(); },
      register(meta, component) { registrations.push({ meta, component }); return { meta, component }; },
    },
  });

  const note = registrations.find((entry) => entry.meta.name === "plugins.bundle.config").component;
  const rendered = note({});
  assert.equal(rendered.type, "section");
  assert.equal(rendered.props.className, "dwmc-panel");
  assert.ok(Array.isArray(rendered.children) && rendered.children.length >= 2, "status head and a pointer note");
  const pointer = rendered.children.find((child) => child && child.props && child.props.className === "dwmc-note");
  assert.ok(pointer, "the plugin card carries a pointer note");
  assert.equal(typeof pointer.children[0], "string", "the pointer is a single localized sentence");

  // The panel body doubles as the Dependency card of the settings page.
  const embedded = exportsObject.__internals.WindowsMcpPanel({ __embedded: true });
  assert.equal(embedded.type, "div");
  assert.equal(embedded.props.className, "dwmc-dep");
  assert.ok(Array.isArray(embedded.children) && embedded.children.length >= 2, "rows and actions, without the panel head");

  const compact = registrations.find((entry) => entry.meta.name === "plugins.bundle.activation").component;
  const compactWrapper = compact({});
  const compactRendered = compactWrapper.type(compactWrapper.props);
  assert.equal(compactRendered.type, "section");
  assert.ok(compactRendered.children.length >= 2, "the prompt still offers the install action");
});

test("client styles keep the pill unfilled and use theme tokens only", () => {
  const { exportsObject } = loadClientBundle();
  const css = exportsObject.__internals.CSS;
  assert.match(css, /--dsw-alias-state-success-primary/u, "the on signal is the green dot");
  assert.match(css, /--dsw-alias-state-warn-primary/u);
  assert.match(css, /--dsw-alias-state-idle-primary/u);

  const onRule = /\.dwmc-pill\[data-state='on'\][^{]*\{[^}]*\}/u.exec(css);
  assert.ok(onRule, "the on state must be styled");
  assert.ok(!/background:color-mix/u.test(onRule[0]), "the on pill must not fill with colour");
  assert.ok(!/border:/u.test(onRule[0]), "the on pill must not gain a border");

  const baseRule = /\.dwmc-pill\{[^}]*\}/u.exec(css);
  assert.ok(baseRule, "the pill base rule must exist");
  assert.ok(!/border:\s*1px/u.test(baseRule[0]), "the pill is borderless");
  assert.match(css, /border-radius:var\(--dsw-radius-sm\)/u, "the radius matches the shell's composer select");
  const hoverRule = /@media \(hover:hover\)\{\.dwmc-pill:hover[^{]*\{[^}]*\}/u.exec(css);
  assert.ok(hoverRule, "the pill has a hover wash");
  assert.match(hoverRule[0], /--dsw-alias-interactive-bg-hover/u, "the wash is the shell's own hover token");
  assert.ok(!/(?:^|[;{ ])color:/u.test(hoverRule[0]), "the shell never recolours the label on hover");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/u.test(css), "no literal colours, the theme must supply them");
});

test("a long field hint wraps inside its label instead of pushing the control down", () => {
  const { exportsObject } = loadClientBundle();
  const label = /\.dwmc-field__label\{[^}]*\}/u.exec(exportsObject.__internals.CSS);
  assert.ok(label, "the field label rule exists");
  assert.match(
    label[0],
    /flex:1 1 0/u,
    "with the default `auto` basis the hint's full width overflows the row and wraps the checkbox onto its own line",
  );
});

test("client bundle registers the settings page with brand links in its header", () => {
  const { exportsObject } = loadClientBundle();
  assert.equal(exportsObject.__internals.SETTINGS_SLOT, "settings.section");
  assert.equal(exportsObject.__internals.SETTINGS_NAV_ICON_SLOT, "settings.section.icon");
  assert.equal(exportsObject.__internals.SETTINGS_PATH, "/dsh-windows-mcp/settings");
  assert.equal(exportsObject.__internals.REPO_URL, "https://github.com/helloHub1212/dsh-windows-mcp");
  assert.equal(exportsObject.__internals.NPM_URL, "https://www.npmjs.com/package/dsh-windows-mcp");
  assert.equal(
    exportsObject.__internals.UPSTREAM_UIA_ISSUE,
    "https://github.com/CursorTouch/Windows-MCP/issues/607",
    "the empty-UIA upstream report is a stable link, not scattered prose",
  );
  assert.ok(clientSource.includes("diagnosticsHint"), "the dependency card explains why tools can succeed and do nothing");
  assert.ok(clientSource.includes("CursorTouch/Windows-MCP#607"), "the note links the upstream report");
  assert.ok(exportsObject.__internals.CSS.includes(".dwmc-note a{"), "the note link stays readable inside settings");
  assert.ok(clientSource.includes('brandLink("GitHub", REPO_URL)'), "the repo link became a header pill");
  assert.ok(clientSource.includes('brandLink("npm", NPM_URL)'), "the package link sits beside it");
  assert.ok(!clientSource.includes("starHint"), "the star nag is gone with the about card");
  assert.ok(clientSource.includes('className: "dwmc-set__link-icon"'), "each brand pill carries its mark");
  assert.ok(clientSource.includes("BRAND_ICON_PATHS"), "the marks are inlined: a client bundle cannot import the host's icons");

  assert.ok(exportsObject.__internals.CSS.includes(".dwmc-dep{"), "the embedded panel has its own layout hook");
  assert.ok(!clientSource.includes("data-dwmc-nav-icon"), "the rail is the shell's to draw, not a DOM puppet");

  const registrations = [];
  exportsObject.apply({
    slots: {
      inject(_name, callback) { callback(); },
      register(meta, component) { registrations.push({ meta, component }); return { meta, component }; },
    },
  });

  const section = registrations.find((entry) => entry.meta.name === "settings.section");
  assert.ok(section, "the settings section must be registered");
  assert.equal(section.meta.id, "windows-mcp-settings");
  assert.equal(typeof section.meta.order, "number");
  assert.equal(typeof section.meta.label(), "string");
  assert.equal(typeof section.component, "function");
  const rendered = section.component({});
  assert.equal(typeof rendered.type, "function", "the slot renders the settings page component");
  const page = rendered.type(rendered.props ?? {});
  assert.equal(typeof page.type, "string", "the page renders without throwing while loading");

  const glyph = registrations.find((entry) => entry.meta.name === "settings.section.icon");
  assert.ok(glyph, "the nav glyph must be registered into the shell's own icon slot");
  assert.equal(glyph.meta.id, section.meta.id, "the glyph is addressed by the matching section id");
  assert.equal(typeof glyph.meta.order, "number");
  assert.equal(typeof glyph.component, "function");
  const drawing = glyph.component({ size: 16, active: true });
  assert.equal(drawing.type, "svg", "the glyph is an inline svg the shell can size");
  assert.equal(drawing.props.width, 16);
  assert.equal(drawing.props.height, 16);
  assert.equal(drawing.props.viewBox, "0 0 16 16");
  assert.equal(drawing.props.fill, "currentColor", "the glyph takes its colour from the nav row");
  assert.equal(drawing.props["aria-hidden"], "true", "the label already names the row");
  assert.equal(drawing.children.length, 3, "screen, stand stem and stand base");
  assert.equal(glyph.component({}).props.width, 16, "the shell's square edge falls back to 16px");
});

test("the settings draft keeps the lazy tools switch", () => {
  const { exportsObject } = loadClientBundle();
  const clone = exportsObject.__internals.cloneSettings;

  assert.equal(clone({}).plugin.lazyTools, true, "an untouched draft keeps lazy tools on");
  assert.equal(clone({ plugin: {} }).plugin.lazyTools, true, "a missing switch falls back to the default");
  assert.equal(clone({ plugin: { lazyTools: false } }).plugin.lazyTools, false, "an off switch survives the copy");
  assert.equal(clone({ plugin: { lazyTools: "no" } }).plugin.lazyTools, true, "a non-boolean reads as the default");

  const copied = clone({ plugin: { lazyTools: false }, bridge: { toolCallTimeoutMs: 9000 } });
  assert.equal(copied.bridge.toolCallTimeoutMs, 9000, "the rest of the settings still copy over");

  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.ok(source.includes("checked: draft.plugin.lazyTools !== false"), "the checkbox reads the drafted switch");
});

test("the settings page carries the default grant for new sessions", () => {
  const { exportsObject } = loadClientBundle();
  const clone = exportsObject.__internals.cloneSettings;

  assert.equal(clone({}).plugin.defaultGrant, false, "an untouched draft grants nothing");
  assert.equal(clone({ plugin: { defaultGrant: true } }).plugin.defaultGrant, true, "an opt-in survives the copy");
  assert.equal(clone({ plugin: { defaultGrant: "yes" } }).plugin.defaultGrant, false, "a non-boolean reads as the safe default");
  assert.equal(clone({ plugin: { defaultGrant: false } }).plugin.defaultGrant, false);

  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.ok(
    source.includes('checked: draft.plugin.defaultGrant === true'),
    "the row is a checkbox bound to the drafted value, not to a rendered snapshot",
  );
  assert.ok(
    source.includes('update("plugin", "defaultGrant", event.target.checked)'),
    "ticking it writes the setting the host reads as the fallback",
  );
});

test("ticking a settings checkbox always means the feature is on", () => {
  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  // `disableFlash` is stored as a negative while its label is positive, so a
  // naive `checked: draft.bridge.disableFlash` inverts the whole control.
  assert.ok(source.includes("checked: draft.bridge.disableFlash !== true"), "the flash box reads the positive sense");
  assert.ok(
    source.includes('update("bridge", "disableFlash", event.target.checked !== true)'),
    "unticking turns the border on, not the stored flag",
  );
  for (const hint of ["flashHint", "excludeHint", "autoCheckHint", "lazyHint"]) {
    assert.match(source, new RegExp(`${hint}: "[^"]*勾选后`, "u"), `${hint} must say what ticking does`);
  }
});

test("the settings payload carries the values behind Restore defaults", async () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-windows-mcp-defaults-"));
  process.env.DSH_HOME = home;
  const fresh = await import(`../lib/index.js?defaults=${Date.now()}`);
  const routes = new Map();
  fresh.apply({
    logger: { warn() {} },
    inject(services, callback) {
      if (services.includes("webServer")) {
        callback({
          webServer: { register(candidate) { routes.set(candidate.path, candidate); return () => {}; } },
          get: () => undefined,
        });
        return;
      }
      callback({ tools: { register() { return () => {}; }, guard() { return () => {}; } } });
    },
  });

  const route = routes.get("/dsh-windows-mcp/settings");
  assert.ok(route, "the settings route must be registered");
  const get = fakeResponse();
  route.handler({ method: "GET" }, get);
  assert.equal(get.status, 200);
  const body = JSON.parse(get.body);
  assert.equal(typeof body.defaults, "object", "the page cannot restore what it is not told");
  assert.equal(body.defaults.plugin.lazyTools, true);
  assert.equal(body.defaults.bridge.disableFlash, true, "the flash border is off by default");
});

test("a reloaded bundle replaces its stylesheet instead of trusting the old one", () => {
  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.ok(
    !source.includes("if (document.getElementById(STYLE_ID) !== null) return;"),
    "an early return would leave new markup wearing the previous rules",
  );
  assert.ok(source.includes("if (element.textContent !== CSS) element.textContent = CSS;"), "the rules are rewritten in place");
});

test("the settings page says nothing about its own saving", () => {
  const { exportsObject } = loadClientBundle();
  const css = exportsObject.__internals.CSS;
  assert.ok(!/\.dwmc-status\{/u.test(css), "no save-state chip is styled");

  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  for (const gone of ["settingsSaving", "settingsSaved", "settingsFailed", "settingsAutoSave", "saveTone"]) {
    assert.ok(!source.includes(gone), `${gone} must not survive the removal`);
  }
  assert.ok(source.includes('notes.length === 0'), "the trailing row is conditional");
  assert.ok(source.includes('className: "dwmc-set__status" }, notes'), "it now carries only actionable notes");
});

test("the settings page saves itself and keeps only the defaults action at the end", () => {
  const { exportsObject } = loadClientBundle();
  const css = exportsObject.__internals.CSS;
  assert.match(css, /\.dwmc-set__footer\{[^}]*justify-content:flex-end/u, "the remaining action sits on the right");
  assert.ok(!/\.dwmc-set__savebar\{/u.test(css), "nothing floats over the form any more");

  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.ok(source.includes("saveRef.current(payload)"), "changes reach the host without a save button");
  assert.match(source, /\}, 700\);/u, "the push is debounced instead of firing on every keystroke");
  assert.ok(!/settingsSave:/u.test(source), "the save copy is gone with the button");
  assert.ok(!source.includes('key: "save"'), "there is no save button to press");
  assert.ok(!source.includes("t.settingsDiscard"), "nothing is left to discard");
  assert.ok(source.includes("settingsDefaultsConfirm"), "restoring defaults asks before it drops the draft");
  assert.ok(source.includes('confirm === "defaults"'), "the confirmation replaces the footer buttons instead of stacking");
});

test("a failed auto-save still says so", () => {
  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.equal((source.match(/settingsWriteFailed:/gu) ?? []).length, 2, "both languages carry the failure copy");
  assert.match(source, /className: "dwmc-error" \},\s*t\.settingsWriteFailed/u, "the note is an error, not a hint");
  assert.ok(source.includes('host.saved.phase === "error"'), "the failure state drives it");
  assert.ok(
    source.includes("(body.write && body.write.error) || body.error"),
    "the bridge-write reason is not dropped by an ok:false body",
  );
});

test("the welcome dialog is a portal modal that fires on activation", () => {
  const { exportsObject } = loadClientBundle();
  const internals = exportsObject.__internals;
  assert.equal(internals.WELCOME_STORAGE_KEY, "dsh-windows-mcp:welcome");
  assert.equal(internals.WELCOME_PENDING_KEY, "dsh-windows-mcp:welcome-pending");
  assert.equal(internals.WELCOME_EVENT, "dsh-windows-mcp:welcome");
  assert.equal(typeof internals.requestWelcome, "function");
  assert.equal(typeof internals.WelcomeDialog, "function");
  assert.equal(typeof internals.WelcomeHost, "function");
  assert.equal(typeof internals.ComposerEntry, "function");
  assert.equal(internals.WELCOME_PORTAL, false, "no react-dom in this sandbox: the in-place fallback is used");

  const css = internals.CSS;
  assert.ok(css.includes(".dwmc-scrim{"), "the scrim is its own layer");
  assert.ok(css.includes("--dsw-alias-bg-mask-1"), "the scrim takes the shell's mask colour");
  assert.ok(css.includes("--dsw-mask-blur"), "the scrim takes the shell's blur");
  assert.ok(css.includes(".dwmc-dialog{"), "the card is styled");
  assert.ok(css.includes("background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 70%,transparent)"), "the card is a glass sheet");
  assert.ok(css.includes("backdrop-filter:blur(18px) saturate(155%)"), "the card frosted");
  assert.ok(css.includes("@keyframes dwmc-fadein"), "the scrim fades in");
  assert.ok(css.includes("@keyframes dwmc-rise"), "the card rises in");
  assert.ok(css.includes(".dwmc-star--hero{"), "the welcome star is the prominent variant");

  const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
  assert.ok(source.includes('require("react-dom")'), "react-dom is tried for the portal");
  assert.ok(source.includes("createPortal(scrim, document.body)"), "the dialog leaves #root");
  assert.ok(source.includes('role: "dialog"'), "the surface is a real dialog for assistive tech");
  assert.ok(source.includes('"aria-modal": "true"'), "the surface is modal");
  assert.ok(source.includes("requestWelcome({ force: true })"), "the activation prompt always shows it");
  assert.ok(source.includes("!!welcomeSeen()") === false, "sanity: no stray comparison");
  assert.ok(source.includes("if (!welcomeSeen()) setOpen(true)") === false, "sanity: the mount check gained the pending flag");
  assert.ok(source.includes("if (pending || !welcomeSeen()) setOpen(true)"), "the composer cell is the fallback trigger");
  assert.ok(source.includes('localStorage.setItem(WELCOME_PENDING_KEY, "1")'), "an activation outside the page leaves a note");
  assert.ok(source.includes('"Escape"'), "Escape closes it");
  assert.ok(source.includes("onMouseDown"), "the backdrop closes it");
});
/* ------------------------------------------------------------------ *
 * dependency lifecycle
 * ------------------------------------------------------------------ */

test("dependency helpers read the pin and quote YAML scalars safely", () => {
  assert.equal(windowsMcpVersionPin("args: [windows-mcp@0.8.8, serve]"), "0.8.8");
  assert.equal(windowsMcpVersionPin("no pin here"), null);
  assert.equal(yamlScalar("C:\\Program Files\\x.exe"), "'C:\\Program Files\\x.exe'", "backslashes stay literal");
  assert.equal(yamlScalar("it's"), "'it''s'", "single quotes are doubled");
});

test("the machine-written block is idempotent and keeps the rest of the file", () => {
  const original = ['- id: agent-default-model', '  name: "@deepseek-ai/dsh-agent-default-model"', ""].join("\n");
  const once = withBridgeOverride(original, bridgeOverrideBlock("C:\\uv\\windows-mcp.exe", { stamp: "2026-01-01T00:00:00.000Z", version: "0.1.0" }));
  const twice = withBridgeOverride(once, bridgeOverrideBlock("D:\\other\\windows-mcp.exe", { stamp: "2026-01-02T00:00:00.000Z", version: "0.1.0" }));

  assert.ok(once.includes("agent-default-model"), "existing rows survive a write");
  assert.equal(twice.split(">>> dsh-windows-mcp").length - 1, 1, "only one machine block remains");
  assert.ok(twice.includes("D:\\other\\windows-mcp.exe"));
  assert.ok(!twice.includes("C:\\uv\\windows-mcp.exe"), "the previous block is replaced, not stacked");

  if (yaml !== null) {
    const parsed = yaml.load(twice);
    assert.ok(Array.isArray(parsed), "the result must stay a top-level list");
    const row = parsed.find((entry) => entry?.id === "windows-mcp-bridge");
    assert.ok(row, "the override row must parse");
    assert.equal(row.disabled, false, "the machine block re-enables the row the bundle patch ships inert");
    assert.equal(row.config.command, "D:\\other\\windows-mcp.exe");
    assert.equal(row.config.serverName, "windows");
    assert.equal(row.config.transport, "stdio");
  }
});

test("writeBridgeOverride finds the profile, backs it up and writes the row", () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-windows-mcp-home-"));
  const profile = join(home, "profiles", "desktop");
  mkdirSync(join(profile, "node_modules", "dsh-windows-mcp"), { recursive: true });
  const patchFile = join(profile, "cordis.patch.yml");
  writeFileSync(patchFile, "- id: bili-native\n  disabled: false\n", "utf8");
  const executable = join(home, "windows-mcp.exe");
  writeFileSync(executable, "", "utf8");

  const outcome = writeBridgeOverride(executable, { home, warn() {}, version: "0.1.0" });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.path, patchFile);
  assert.ok(outcome.backup !== null && existsSync(outcome.backup), "the profile patch layer is backed up");
  const written = readFileSync(patchFile, "utf8");
  assert.ok(written.includes("bili-native"), "existing rows survive");
  assert.ok(written.includes("machine written"));
  if (yaml !== null) {
    const row = yaml.load(written).find((entry) => entry?.id === "windows-mcp-bridge");
    assert.equal(row.config.command, executable);
  }

  const again = writeBridgeOverride(executable, { home, warn() {}, version: "0.1.0" });
  assert.equal(again.ok, true);
  assert.equal(readFileSync(patchFile, "utf8").split(">>> dsh-windows-mcp").length - 1, 1, "still one block");

  const nowhere = writeBridgeOverride(executable, { home: mkdtempSync(join(tmpdir(), "dsh-empty-profile-")), warn() {} });
  assert.equal(nowhere.ok, false);
  assert.match(nowhere.error, /no profile/u);

  const missing = writeBridgeOverride(join(home, "nope.exe"), { home, warn() {} });
  assert.equal(missing.ok, false);
});

test("the profile writer prefers the profile this host booted", () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-two-profiles-"));
  const executable = join(home, "windows-mcp.exe");
  writeFileSync(executable, "", "utf8");
  for (const name of ["alpha", "beta"]) {
    const profile = join(home, "profiles", name);
    mkdirSync(join(profile, "node_modules", "dsh-windows-mcp"), { recursive: true });
    writeFileSync(join(profile, "cordis.patch.yml"), "- id: bili-native\n  disabled: false\n", "utf8");
  }
  const booted = join(home, "profiles", "beta");

  assert.equal(currentProfileDirectory({ DSH_PROFILE_DIR: booted }), booted);
  assert.equal(currentProfileDirectory({ DSH_PROFILE: "alpha" }), join(dshHome(), "profiles", "alpha"));
  assert.equal(currentProfileDirectory({ DSH_WINDOWS_MCP_PROFILE: "alpha" }), join(dshHome(), "profiles", "alpha"));
  assert.equal(currentProfileDirectory({ DSH_WINDOWS_MCP_PROFILE: booted }), booted, "the escape hatch also takes an absolute directory");
  assert.equal(currentProfileDirectory({}), null);
  assert.equal(profileFromArgv(["node", "cli.js", "--profile", "dweb", "--port", "3999"]), "dweb");
  assert.equal(profileFromArgv(["node", "cli.js", "--profile=web"]), "web");
  assert.equal(profileFromArgv(["node", "cli.js"]), null);
  assert.equal(currentProfileDirectory({}, ["node", "cli.js", "--profile", "alpha"]), join(dshHome(), "profiles", "alpha"));
  assert.equal(preferredProfileDirectory(home, { DSH_PROFILE_DIR: booted }).source, "booted");

  const ambiguous = preferredProfileDirectory(home, {});
  assert.equal(ambiguous.source, "ambiguous");
  assert.equal(ambiguous.directory, null, "several installed profiles and no signal: pick none");
  assert.equal(ambiguous.candidates.length, 2);

  const outcome = writeBridgeOverride(executable, {
    home,
    env: { DSH_PROFILE_DIR: booted },
    warn() {},
    version: "0.1.0",
  });
  assert.equal(outcome.path, join(booted, "cordis.patch.yml"), "the booted profile is the one that gets the row");

  // Ambiguous hosts write nothing at all and say how to fix it.
  const refused = writeBridgeOverride(executable, { home, env: {}, warn() {}, version: "0.1.0" });
  assert.equal(refused.ok, false);
  assert.equal(refused.path, null);
  assert.match(refused.error, /installed in 2 profiles \(alpha, beta\)/u);
  assert.match(refused.error, /DSH_WINDOWS_MCP_PROFILE/u);
  assert.equal(
    readFileSync(join(home, "profiles", "alpha", "cordis.patch.yml"), "utf8").includes("machine written"),
    false,
    "the other candidate is untouched",
  );
  assert.equal(readFileSync(join(booted, "cordis.patch.yml"), "utf8").split(">>> dsh-windows-mcp").length - 1, 1, "the earlier write is not repeated");

  // A booted profile outside this home must not leak past the `home` argument.
  const elsewhere = writeBridgeOverride(executable, {
    home,
    env: { DSH_PROFILE_DIR: join(home, "elsewhere") },
    warn() {},
    version: "0.1.0",
  });
  assert.equal(elsewhere.ok, false, "a profile outside this home is not a candidate");
  assert.match(elsewhere.error, /does not report which one it booted/u);
});

test("createPrepare refuses to run without uv", () => {
  const manager = createPrepare({ warn() {}, resolver: () => null, pinned: "0.8.8" });
  const started = manager.start();
  assert.equal(started.started, false);
  assert.match(manager.snapshot().error, /uv/u);
  assert.equal(manager.snapshot().phase, "failed");
  assert.equal(manager.cancel(), false, "nothing to cancel");
});

test("createPrepare runs uv, streams output and settles on failure", async () => {
  // `node tool install …` is a real child process that exits non-zero quickly.
  const manager = createPrepare({ warn() {}, resolver: () => process.execPath, pinned: "0.8.8" });
  const started = manager.start();
  assert.equal(started.started, true);
  assert.equal(started.spec, "windows-mcp@0.8.8");
  assert.equal(manager.start().started, false, "one install at a time");

  for (let attempt = 0; attempt < 80 && manager.snapshot().phase === "running"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const snapshot = manager.snapshot();
  assert.equal(snapshot.phase, "failed");
  assert.match(snapshot.error, /uv exited with code/u);
  assert.ok(snapshot.log.length > 0, "installer output is captured for the page");
});

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function fakeResponse() {
  return {
    status: 0,
    headers: null,
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
    end(payload) { this.body = payload ?? ""; return this; },
  };
}

/**
 * Minimal IncomingMessage stand-in. The handler attaches its listeners after the
 * request object exists, so each subscription delivers its event immediately —
 * `data` first, then `end` — which is the order a real body arrives in.
 */
function fakeRequest(method, body) {
  const request = {
    method,
    on(event, callback) {
      if (event === "data" && body !== undefined) callback(Buffer.from(body));
      if (event === "end") callback();
      return request;
    },
    destroy() {},
  };
  return request;
}
