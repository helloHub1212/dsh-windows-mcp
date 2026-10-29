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
  assert.equal(config.transport, "stdio");
  assert.equal(config.serverName, "windows", "serverName drives the mcp__windows__ prefix");
  assert.equal(config.command, "uvx");
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

test("default export exposes name and apply", () => {
  assert.equal(plugin.name, "dsh-windows-mcp");
  assert.equal(typeof plugin.apply, "function");
});

test("windows_mcp_doctor registers and produces a usable report", () => {
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

  assert.equal(registered.length, 1);
  const definition = registered[0];
  assert.equal(definition.name, "windows_mcp_doctor");
  assert.equal(typeof definition.execute, "function");
  assert.equal(definition.parameters.additionalProperties, false);

  const output = definition.execute({});
  assert.equal(typeof output.report, "string");
  assert.match(output.report, /dsh-windows-mcp \d+\.\d+\.\d+/);
  assert.match(output.report, /uvx\s+:/);
  assert.match(output.report, /windows-mcp-bridge/);
  assert.match(output.report, /computer use\s+:/);
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

  const get = fakeResponse();
  route.handler({ method: "GET" }, get);
  assert.equal(get.status, 200);
  const body = JSON.parse(get.body);
  assert.equal(body.enabled, false, "default is off: desktop control is opt-in");
  assert.equal(body.bridged, 2, "counts only the bridged tools");
  assert.equal(body.serverName, "windows");
  assert.equal(typeof body.dependency, "object", "the page reads dependency status from the same route");
  assert.equal(typeof body.dependency.installed, "boolean");
  assert.equal(body.prepare.phase, "idle", "nothing is installing yet");

  const post = fakeResponse();
  route.handler(fakeRequest("POST", '{"enabled":true}'), post);
  assert.equal(post.status, 200);
  assert.equal(JSON.parse(post.body).enabled, true);
  assert.ok(existsSync(join(home, "dsh-windows-mcp.state.json")), "the switch is persisted");

  const bad = fakeResponse();
  route.handler(fakeRequest("POST", '{"enabled":"yes"}'), bad);
  assert.equal(bad.status, 400);

  const wrongMethod = fakeResponse();
  route.handler({ method: "DELETE" }, wrongMethod);
  assert.equal(wrongMethod.status, 405);
});

test("the Computer Use switch truly hides the bridged tools and refuses them", async () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-windows-mcp-gate-"));
  process.env.DSH_HOME = home;
  const fresh = await import(`../lib/index.js?gate=${Date.now()}`);

  const routes = new Map();
  let assemble = null;
  let guard = null;
  const tools = { schemas: () => [["mcp__windows__Screenshot", {}], ["bash", {}]] };
  fresh.apply({
    logger: { warn() {} },
    on(event, listener) {
      if (event === "system-prompt/assemble") assemble = listener;
    },
    inject(services, callback) {
      if (services.includes("webServer")) {
        callback({
          webServer: { register(candidate) { routes.set(candidate.path, candidate); return () => {}; } },
          get: (key) => (key === "tools" ? tools : undefined),
        });
        return;
      }
      callback({
        tools: {
          register() { return () => {}; },
          guard(candidate) { guard = candidate; return () => {}; },
        },
      });
    },
  });

  assert.equal(typeof assemble, "function", "the prompt assembly must be hooked");
  assert.equal(typeof guard, "function", "a dispatch guard must be installed");

  const assembly = {
    sections: [],
    contexts: [],
    variables: {},
    tools: [{ name: "mcp__windows__Screenshot" }, { name: "bash" }],
  };
  const next = async () => assembly;

  // Default OFF: the desktop is hidden and refused from the very first step.
  const offAssembly = await assemble(assembly, {}, next);
  assert.deepEqual(offAssembly.tools.map((tool) => tool.name), ["bash"], "desktop tools vanish from the model-facing list");
  assert.equal(assembly.tools.length, 2, "the incoming assembly is never mutated");
  assert.match(guard({ name: "mcp__windows__Click" }) ?? "", /Computer Use is switched off/u);
  assert.equal(guard({ name: "bash" }), undefined, "unrelated tools keep working");

  // Flip the switch the way the pill does: both sides come back.
  const post = fakeResponse();
  routes.get("/dsh-windows-mcp/state").handler(fakeRequest("POST", '{"enabled":true}'), post);
  assert.equal(post.status, 200);

  const onAssembly = await assemble(assembly, {}, next);
  assert.equal(onAssembly.tools.length, 2, "the assembly passes through untouched");
  assert.equal(guard({ name: "mcp__windows__Click" }), undefined, "an enabled desktop is callable again");
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
function loadClientBundle() {
  let spec = null;
  const windowStub = { __ModuleLoader__: { load(candidate) { spec = candidate; } } };
  // eslint-disable-next-line no-new-func -- the bundle is a plain CJS factory
  new Function("window", clientSource)(windowStub);
  assert.ok(spec, "the bundle must call __ModuleLoader__.load");

  const elements = [];
  const reactStub = {
    // React flattens arrays and drops empty children; the stub must too, or a
    // panel that passes an array of rows looks empty to the assertions below.
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
    useEffect() {},
    useCallback(callback) { return callback; },
  };
  const exportsObject = spec.factory((name) => {
    if (name === "react") return reactStub;
    throw new Error(`unexpected require: ${name}`);
  });
  return { spec, exportsObject, elements };
}

test("client bundle declares its id, slot and inject list", () => {
  const { spec, exportsObject } = loadClientBundle();
  assert.equal(spec.id, "dsh-windows-mcp");
  assert.equal(typeof exportsObject.apply, "function");
  assert.deepEqual(exportsObject.inject, ["slots"], "only inject the slot service");
  assert.equal(exportsObject.__internals.LABEL, "Computer Use");
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
  const pill = wrapper.type(wrapper.props);
  assert.equal(pill.type, "button");
  assert.equal(pill.props.role, "switch");
  assert.equal(pill.props.className, "dwmc-pill");
  assert.equal(pill.props["aria-checked"], false, "defaults to off while loading");
  assert.equal(pill.props["data-state"], "off");
  assert.equal(typeof pill.props.title, "string");
  assert.ok(pill.props.title.includes("Computer Use"));
  assert.equal(typeof pill.props.onClick, "function");
});

test("the dependency panel renders a plain section with an action row", () => {
  const { exportsObject } = loadClientBundle();
  const registrations = [];
  exportsObject.apply({
    slots: {
      inject(_name, callback) { callback(); },
      register(meta, component) { registrations.push({ meta, component }); return { meta, component }; },
    },
  });

  const panel = registrations.find((entry) => entry.meta.name === "plugins.bundle.config").component;
  const rendered = panel({});
  assert.equal(rendered.type, "section");
  assert.equal(rendered.props.className, "dwmc-panel");
  assert.ok(Array.isArray(rendered.children) && rendered.children.length >= 2, "head, rows and actions");

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
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/u.test(css), "no literal colours, the theme must supply them");
});

test("client bundle registers the settings page with a star link", () => {
  const { exportsObject } = loadClientBundle();
  assert.equal(exportsObject.__internals.SETTINGS_SLOT, "settings.section");
  assert.equal(exportsObject.__internals.SETTINGS_PATH, "/dsh-windows-mcp/settings");
  assert.equal(exportsObject.__internals.REPO_URL, "https://github.com/helloHub1212/dsh-windows-mcp");
  const navIcon = exportsObject.__internals.SETTINGS_NAV_ICON;
  assert.ok(navIcon.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"'), "the mask glyph is a 16px viewBox svg");
  assert.match(navIcon, /fill-rule="evenodd"/u);
  assert.ok(navIcon.endsWith("</svg>"), "the mask glyph is closed");
  assert.equal(exportsObject.__internals.SETTINGS_NAV_ICON_MARKER, "data-dwmc-nav-icon");
  const isOwn = exportsObject.__internals.isOwnSettingsNavRow;
  assert.equal(isOwn("桌面控制", "桌面控制"), true);
  assert.equal(isOwn("  Desktop  ", "Desktop"), true);
  assert.equal(isOwn("桌面控制", "Desktop"), false);
  assert.equal(isOwn("", "桌面控制"), false);
  assert.equal(isOwn("桌面控制", ""), false);
  const maskUrl = exportsObject.__internals.settingsNavMaskUrl();
  assert.ok(maskUrl.startsWith("data:image/svg+xml,"));
  assert.ok(maskUrl.includes("%3Csvg"), "the svg is percent-encoded for a CSS url()");
  assert.ok(!maskUrl.includes("'"), "the url never breaks out of url('…')");
  const iconCss = exportsObject.__internals.settingsNavIconCss(maskUrl);
  assert.ok(iconCss.includes("[data-dwmc-nav-icon] > svg{display:none}"));
  assert.ok(iconCss.includes("[data-dwmc-nav-icon]::before"));
  assert.ok(iconCss.includes("background-color:currentColor"));
  assert.ok(iconCss.includes("mask-image:url('data:image/svg+xml,"));
  assert.ok(iconCss.includes("width:16px;height:16px"));
  assert.ok(!/#[0-9a-f]{3}/iu.test(iconCss), "the glyph takes its colour from currentColor");

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
