/**
 * dsh-windows-mcp — client half.
 *
 * Adds one compact control to the composer tool row: a "Computer Use" pill that
 * turns the Windows desktop capability on and off. It sits in
 * `conversation.input.left` — the shipped seat for compact left-side controls,
 * next to the permission pill — so it never displaces the model selector.
 *
 * Three disciplines, the same ones the shipped client plugins follow:
 *   1. Never break the composer. Anything unexpected (missing slot, failed
 *      fetch, unknown React) fails open: the pill renders as "off/unavailable"
 *      and the rest of the row is untouched.
 *   2. Never lie about state. The pill shows the host's answer, not the click's
 *      optimism; a failed write rolls back and says so in the tooltip.
 *   3. Only theme tokens for colour (`--dsw-*`), so light and dark both work and
 *      no hex value goes stale on a theme change.
 */
window.__ModuleLoader__.load({
  id: "dsh-windows-mcp",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");

    var PACKAGE_ID = "dsh-windows-mcp";
    var SLOT_NAME = "conversation.input.left";
    var ENTRY_ID = "windows-mcp-computer-use";
    var ENTRY_ORDER = 24;
    var STATE_PATH = "/dsh-windows-mcp/state";
    var PREPARE_PATH = "/dsh-windows-mcp/prepare";
    var PREPARE_CANCEL_PATH = "/dsh-windows-mcp/prepare/cancel";
    var BRIDGE_PATH = "/dsh-windows-mcp/bridge";
    var UPDATE_PATH = "/dsh-windows-mcp/update";
    var STYLE_ID = PACKAGE_ID + "-computer-use-styles";
    var LABEL = "Computer Use";
    /** Only `slots` is injected: it is certainly provided, and a declaration for
     *  a service nobody provides would leave this plugin's fiber pending. */
    var inject = ["slots"];

    var CSS = [
      /* Borderless and unfilled in every state: the dot alone carries the state. */
      ".dwmc-pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 7px 0 5px;",
      "border:none;border-radius:999px;background:transparent;",
      "color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;",
      "letter-spacing:.01em;cursor:pointer;white-space:nowrap;user-select:none;",
      "transition:color .14s ease,opacity .14s ease}",
      ".dwmc-pill:hover{color:var(--dsw-alias-label-primary)}",
      ".dwmc-pill:active{transform:translateY(.5px)}",
      ".dwmc-pill:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);",
      "outline-offset:1px}",
      ".dwmc-pill[data-busy='1']{opacity:.65;cursor:progress}",
      ".dwmc-pill[disabled]{cursor:not-allowed;opacity:.5}",
      ".dwmc-dot{width:6px;height:6px;border-radius:999px;flex:none;background:var(--dsw-alias-state-idle-primary);",
      "transition:background-color .18s ease,box-shadow .18s ease}",
      ".dwmc-pill[data-state='on'] .dwmc-dot{background:var(--dsw-alias-state-success-primary);",
      "box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent)}",
      ".dwmc-pill[data-state='warn'] .dwmc-dot{background:var(--dsw-alias-state-warn-primary);",
      "box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 20%,transparent)}",
      ".dwmc-icon{width:14px;height:14px;flex:none;display:block;opacity:.85}",
      ".dwmc-pill:hover .dwmc-icon{opacity:1}",
      "@media (max-width:860px){.dwmc-label{display:none}.dwmc-pill{padding:0 5px}}",
      "@media (prefers-reduced-motion:reduce){.dwmc-pill,.dwmc-dot{transition:none}}",
      /* Plugins-page panel. Borderless like the pill; the brand only outlines. */
      ".dwmc-dot[data-tone='on']{background:var(--dsw-alias-state-success-primary)}",
      ".dwmc-dot[data-tone='warn']{background:var(--dsw-alias-state-warn-primary)}",
      ".dwmc-dot[data-tone='off']{background:var(--dsw-alias-state-idle-primary)}",
      ".dwmc-panel{display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.55;",
      "color:var(--dsw-alias-label-primary)}",
      ".dwmc-panel__head{display:flex;align-items:center;gap:8px;font-weight:600}",
      ".dwmc-rows{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0}",
      ".dwmc-rows dt{color:var(--dsw-alias-label-secondary);white-space:nowrap}",
      ".dwmc-rows dd{margin:0;min-width:0;overflow-wrap:anywhere}",
      ".dwmc-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
      ".dwmc-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;font:inherit;",
      "font-size:12px;cursor:pointer;border-radius:8px;border:1px solid transparent;background:transparent;",
      "color:var(--dsw-alias-brand-primary);",
      "box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent)}",
      ".dwmc-btn:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}",
      ".dwmc-btn:disabled{opacity:.55;cursor:not-allowed;background:transparent}",
      ".dwmc-btn--quiet{color:var(--dsw-alias-label-secondary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}",
      ".dwmc-btn--quiet:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}",
      ".dwmc-note{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".dwmc-warn{margin:0;font-size:12px;color:var(--dsw-alias-state-warn-primary)}",
      ".dwmc-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}",
      ".dwmc-progress{height:3px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}",
      ".dwmc-progress>i{display:block;height:100%;width:38%;border-radius:999px;",
      "background:var(--dsw-alias-brand-primary);animation:dwmc-slide 1.4s ease-in-out infinite}",
      "@keyframes dwmc-slide{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}",
      ".dwmc-log{margin:0;max-height:120px;overflow:auto;font-size:11px;line-height:1.45;",
      "color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all}",
      ".dwmc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}",
      "@media (prefers-reduced-motion:reduce){.dwmc-progress>i{animation:none}}",
    ].join("");

    /** Inject the stylesheet once. Failures are cosmetic and never fatal. */
    function installStyles() {
      try {
        if (typeof document === "undefined") return;
        if (document.getElementById(STYLE_ID) !== null) return;
        var element = document.createElement("style");
        element.id = STYLE_ID;
        element.textContent = CSS;
        document.head.appendChild(element);
      } catch (error) {
        /* a missing stylesheet only costs polish */
      }
    }

    /**
     * Same-origin URL for a host route. Anchored on `document.baseURI`, the
     * directory the host serves its UI from, because the host does not use path
     * routing (measured: `location.pathname` is `/`).
     */
    function apiUrl(path) {
      var relative = String(path).replace(/^\/+/, "");
      try {
        if (typeof document === "undefined") return "/" + relative;
        return new URL(relative, document.baseURI).pathname;
      } catch (error) {
        return "/" + relative;
      }
    }

    /** A screen with a pointer: desktop control, not "another tool". */
    function screenIcon() {
      return React.createElement(
        "svg",
        {
          className: "dwmc-icon",
          viewBox: "0 0 16 16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.4",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          focusable: "false",
        },
        React.createElement("rect", { x: "1.4", y: "2.4", width: "13.2", height: "9", rx: "1.6" }),
        React.createElement("path", { d: "M5.6 14.2h4.8" }),
        React.createElement("path", { d: "M8 11.4v2.8" }),
        React.createElement("path", { d: "M9.2 6.1l3 1.1-1.2.7-.7 1.2z", fill: "currentColor", stroke: "none" }),
      );
    }

    /**
     * Read and write the host's flag. The host is the source of truth: the pill
     * renders whatever `/state` answers and rolls back when a write is refused.
     */
    function useComputerUse() {
      var initial = { phase: "loading", enabled: false, bridged: null, busy: false, error: null };
      var pair = React.useState(initial);
      var view = pair[0];
      var setView = pair[1];

      var load = React.useCallback(function () {
        try {
          fetch(apiUrl(STATE_PATH), { cache: "no-store", headers: { accept: "application/json" } })
            .then(function (response) {
              if (!response.ok) throw new Error("HTTP " + response.status);
              return response.json();
            })
            .then(function (body) {
              setView({
                phase: "ready",
                enabled: body && body.enabled === true,
                bridged: typeof (body && body.bridged) === "number" ? body.bridged : null,
                busy: false,
                error: null,
              });
            })
            .catch(function (error) {
              setView({ phase: "error", enabled: false, bridged: null, busy: false, error: String(error && error.message ? error.message : error) });
            });
        } catch (error) {
          setView({ phase: "error", enabled: false, bridged: null, busy: false, error: String(error) });
        }
      }, []);

      React.useEffect(function () {
        load();
      }, [load]);

      var toggle = React.useCallback(function () {
        if (view.phase === "loading" || view.busy) return;
        var next = !view.enabled;
        setView({ phase: view.phase, enabled: next, bridged: view.bridged, busy: true, error: null });
        try {
          fetch(apiUrl(STATE_PATH), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled: next }),
          })
            .then(function (response) {
              if (!response.ok) throw new Error("HTTP " + response.status);
              return response.json();
            })
            .then(function (body) {
              setView({
                phase: "ready",
                enabled: body && body.enabled === true,
                bridged: typeof (body && body.bridged) === "number" ? body.bridged : view.bridged,
                busy: false,
                error: null,
              });
            })
            .catch(function (error) {
              setView({
                phase: "ready",
                enabled: !next,
                bridged: view.bridged,
                busy: false,
                error: String(error && error.message ? error.message : error),
              });
            });
        } catch (error) {
          setView({ phase: "ready", enabled: !next, bridged: view.bridged, busy: false, error: String(error) });
        }
      }, [view]);

      return [view, toggle, load];
    }

    /** Tooltip copy: state first, then what the switch does, then any failure. */
    function tooltipFor(view) {
      var head;
      if (view.phase === "loading") head = "Computer Use — checking…";
      else if (view.phase === "error") head = "Computer Use — host unreachable (" + view.error + ")";
      else if (!view.enabled) head = "Computer Use is OFF — desktop tools are hidden from the model and refused";
      else if (view.bridged === 0) head = "Computer Use is ON — but no desktop tool is registered yet";
      else if (typeof view.bridged === "number") head = "Computer Use is ON — " + view.bridged + " desktop tools available";
      else head = "Computer Use is ON";
      return (
        head +
        "\n" +
        "允许 agent 操作这台电脑的桌面（截屏、点击、输入、剪贴板、进程、注册表），由 Windows-MCP 提供。\n" +
        "关闭后这些工具会从模型眼前隐藏，调用也会被拒绝。\n" +
        (view.phase === "ready" || view.phase === "loading" ? "点击切换 / click to toggle" : "点击重试 / click to retry")
      );
    }

    /** The pill itself. */
    function ComputerUsePill() {
      var triple = useComputerUse();
      var view = triple[0];
      var toggle = triple[1];
      var reload = triple[2];

      var state = view.phase === "error" ? "warn" : !view.enabled ? "off" : view.bridged === 0 ? "warn" : "on";
      var onClick = view.phase === "error" ? reload : toggle;

      return React.createElement(
        "button",
        {
          type: "button",
          className: "dwmc-pill",
          "data-state": state,
          "data-busy": view.busy ? "1" : "0",
          role: "switch",
          "aria-checked": view.enabled === true,
          "aria-label": LABEL,
          title: tooltipFor(view),
          onClick: onClick,
        },
        React.createElement("span", { className: "dwmc-dot" }),
        screenIcon(),
        React.createElement("span", { className: "dwmc-label" }, LABEL),
      );
    }

    /* ------------------------------------------------------------------ *
     * dependency panel — Settings → Plugins → this bundle
     * ------------------------------------------------------------------ */

    /** Bilingual copy, chosen from the browser language. */
    var COPY = {
      zh: {
        title: "Windows 桌面自动化（Windows-MCP）",
        dependency: "依赖",
        installed: "已安装",
        missing: "未安装",
        uvMissing: "未找到 uv",
        tool: "可执行文件",
        bridge: "桥",
        bridgedTools: "个工具已注册",
        profile: "写入目标",
        profileAmbiguous: "检测到多个已装本插件的 profile，写入前请在本机设置 DSH_WINDOWS_MCP_PROFILE",
        toggle: "Computer Use 开关",
        on: "开",
        off: "关",
        install: "下载并安装",
        reinstall: "重新下载",
        cancel: "取消",
        pointBridge: "让桥指向它",
        estimate: "首次约 60 MB，一次即可；安装完成后会自动把桥指向它，重启 DSH 生效。",
        running: "正在下载并安装…",
        ok: "安装完成",
        failed: "安装失败",
        cancelled: "已取消",
        ready: "依赖已就绪，桌面工具可用（记得把 Computer Use 开关打开）。",
        restart: "已把桥指向新安装的版本，重启 DSH 后生效。",
        hostDown: "连不上宿主",
        version: "运行版本",
        latest: "最新版本",
        previous: "可回退",
        kept: "已保留版本",
        mirror: "镜像",
        updateAvailable: "有新版本",
        upToDate: "已是最新",
        notChecked: "还没检查",
        check: "检查更新",
        checking: "正在测速…",
        updateTo: "更新到",
        rollback: "回退到",
        installVersion: "安装版本",
        versionInstalled: "版本已切换，重启 DSH 生效。",
        noPrevious: "没有可回退的版本",
        updateHint: "更新只下载新版本、旧版本原样保留；出问题一键回退，不需要重装依赖。",
      },
      en: {
        title: "Windows desktop automation (Windows-MCP)",
        dependency: "Dependency",
        installed: "installed",
        missing: "not installed",
        uvMissing: "uv not found",
        tool: "Executable",
        bridge: "Bridge",
        bridgedTools: "tools registered",
        profile: "Patch target",
        profileAmbiguous: "this package is installed in several profiles — set DSH_WINDOWS_MCP_PROFILE on this host",
        toggle: "Computer Use switch",
        on: "on",
        off: "off",
        install: "Download and install",
        reinstall: "Reinstall",
        cancel: "Cancel",
        pointBridge: "Point the bridge at it",
        estimate: "About 60 MB once; when it finishes the bridge is pointed at it automatically and a DSH restart applies that.",
        running: "Downloading and installing…",
        ok: "Install finished",
        failed: "Install failed",
        cancelled: "Cancelled",
        ready: "Dependency ready — the desktop tools are available (turn the Computer Use switch on).",
        restart: "The bridge now points at the freshly installed build; restart DSH to apply it.",
        hostDown: "Host unreachable",
        version: "Running version",
        latest: "Latest version",
        previous: "Rollback to",
        kept: "Kept versions",
        mirror: "Mirror",
        updateAvailable: "update available",
        upToDate: "up to date",
        notChecked: "not checked yet",
        check: "Check for updates",
        checking: "Probing mirrors…",
        updateTo: "Update to",
        rollback: "Roll back to",
        installVersion: "Install version",
        versionInstalled: "Version switched — restart DSH to apply it.",
        noPrevious: "no previous version to roll back to",
        updateHint: "An update only downloads the new build; the old one is kept as-is. Roll back with one click — no reinstall.",
      },
    };

    function copy() {
      try {
        return String(navigator.language || "").toLowerCase().indexOf("zh") === 0 ? COPY.zh : COPY.en;
      } catch (error) {
        return COPY.en;
      }
    }

    /** GET /state on a timer; only the Plugins page mounts this. */
    function useHostState(intervalMs) {
      var pair = React.useState({ phase: "loading", state: null, error: null });
      var view = pair[0];
      var setView = pair[1];
      var load = React.useCallback(function () {
        try {
          fetch(apiUrl(STATE_PATH), { cache: "no-store", headers: { accept: "application/json" } })
            .then(function (response) {
              if (!response.ok) throw new Error("HTTP " + response.status);
              return response.json();
            })
            .then(function (body) {
              setView({ phase: "ready", state: body, error: null });
            })
            .catch(function (error) {
              setView({ phase: "error", state: null, error: String(error && error.message ? error.message : error) });
            });
        } catch (error) {
          setView({ phase: "error", state: null, error: String(error) });
        }
      }, []);
      React.useEffect(
        function () {
          load();
          var timer = setInterval(load, intervalMs || 2500);
          return function () {
            clearInterval(timer);
          };
        },
        [load, intervalMs],
      );
      return [view, load];
    }

    function postAction(path) {
      return fetch(apiUrl(path), { method: "POST", headers: { accept: "application/json" } }).then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, status: response.status, body: body };
        });
      });
    }

    /** POST JSON — used by the version manager (check / install / activate / rollback). */
    function postJson(path, payload) {
      return fetch(apiUrl(path), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(payload || {}),
      }).then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, status: response.status, body: body };
        });
      });
    }

    function statusDot(tone) {
      return React.createElement("span", { className: "dwmc-dot", "data-tone": tone });
    }

    function actionButton(label, onClick, disabled, quiet) {
      return React.createElement(
        "button",
        {
          type: "button",
          className: quiet === true ? "dwmc-btn dwmc-btn--quiet" : "dwmc-btn",
          disabled: disabled === true,
          onClick: onClick,
        },
        label,
      );
    }

    /**
     * The panel the bundle's page shows: dependency state, one install button,
     * live progress, and the outcome of pointing the bridge at the result.
     */
    function WindowsMcpPanel(props) {
      var compact = props !== null && props !== undefined && props.__compact === true;
      var t = copy();
      var triple = useHostState(compact ? 8000 : 2500);
      var view = triple[0];
      var reload = triple[1];
      var busyPair = React.useState(false);
      var busy = busyPair[0];
      var setBusy = busyPair[1];

      var state = view.state || {};
      var dependency = state.dependency || {};
      var prepare = state.prepare || { phase: "idle", log: [] };
      var running = prepare.phase === "running";
      var installed = dependency.installed === true;
      var bridged = typeof state.bridged === "number" ? state.bridged : null;
      var log = Array.isArray(prepare.log) ? prepare.log : [];
      var update = state.update || {};
      var versions = update.versions || {};
      var check = update.check || {};
      var install = update.install || {};
      var updateAvailable = versions.updateAvailable === true && typeof check.latest === "string";
      var mirrors = Array.isArray(check.mirrors) ? check.mirrors : [];
      var bestMirror = null;
      for (var mirrorIndex = 0; mirrorIndex < mirrors.length; mirrorIndex += 1) {
        if (mirrors[mirrorIndex] && mirrors[mirrorIndex].id === check.best) {
          bestMirror = mirrors[mirrorIndex];
          break;
        }
      }
      var profile = dependency.profile && typeof dependency.profile === "object" ? dependency.profile : null;
      var profileTarget =
        profile === null
          ? "—"
          : typeof profile.target === "string" && profile.target !== ""
            ? profile.target
            : profile.source === "ambiguous"
              ? t.profileAmbiguous
              : "—";

      var act = function (path) {
        setBusy(true);
        postAction(path)
          .catch(function () {
            /* the next poll reports the truth */
          })
          .then(function () {
            setBusy(false);
            reload();
          });
      };

      var actUpdate = function (payload) {
        setBusy(true);
        postJson(UPDATE_PATH, payload)
          .catch(function () {
            /* the next poll reports the truth */
          })
          .then(function () {
            setBusy(false);
            reload();
          });
      };

      var speedText = function (bytesPerSecond) {
        var value = Number(bytesPerSecond);
        if (!isFinite(value) || value <= 0) return "—";
        return value >= 1048576 ? (value / 1048576).toFixed(1) + " MB/s" : Math.max(1, Math.round(value / 1024)) + " KB/s";
      };

      var head = React.createElement(
        "div",
        { className: "dwmc-panel__head", key: "head" },
        statusDot(running ? "warn" : updateAvailable ? "warn" : installed ? "on" : "warn"),
        React.createElement("span", null, t.title),
      );

      var children = [head];
      if (!compact) {
        var rows = [
          [t.dependency, installed ? t.installed + (dependency.version ? " " + dependency.version : "") : dependency.uv === null ? t.uvMissing : t.missing],
          [t.version, versions.active ? "v" + versions.active : dependency.version ? "v" + dependency.version : "—"],
          [
            t.latest,
            typeof check.latest === "string"
              ? "v" + check.latest + " · " + (updateAvailable ? t.updateAvailable : t.upToDate)
              : t.notChecked,
          ],
        ];
        if (typeof versions.previous === "string") rows.push([t.previous, "v" + versions.previous]);
        if (Array.isArray(versions.available) && versions.available.length > 0) {
          rows.push([t.kept, versions.available.map(function (version) { return "v" + version; }).join(", ")]);
        }
        if (bestMirror !== null) rows.push([t.mirror, bestMirror.label + " · " + speedText(bestMirror.speedBps)]);
        rows.push([t.tool, dependency.executable || "—"]);
        rows.push([t.bridge, bridged === null ? "—" : bridged + " " + t.bridgedTools]);
        rows.push([t.profile, profileTarget]);
        rows.push([t.toggle, state.enabled === true ? t.on : t.off]);
        children.push(
          React.createElement(
            "dl",
            { className: "dwmc-rows", key: "rows" },
            rows.map(function (row, index) {
              return [
                React.createElement("dt", { key: "dt" + index }, row[0]),
                React.createElement("dd", { key: "dd" + index, className: "dwmc-mono" }, String(row[1])),
              ];
            }),
          ),
        );
      }

      if (running) {
        children.push(React.createElement("div", { className: "dwmc-progress", key: "progress" }, React.createElement("i")));
        children.push(
          React.createElement(
            "p",
            { className: "dwmc-note", key: "running" },
            (install.version ? t.installVersion + " v" + install.version + "… " : "") + t.running,
          ),
        );
        var tail = log.slice(-3).join("\n");
        if (tail) children.push(React.createElement("pre", { className: "dwmc-log", key: "log" }, tail));
      } else if (prepare.phase === "failed") {
        children.push(React.createElement("p", { className: "dwmc-error", key: "failed" }, t.failed + ": " + (prepare.error || "unknown error")));
        var failTail = log.slice(-2).join("\n");
        if (failTail) children.push(React.createElement("pre", { className: "dwmc-log", key: "failLog" }, failTail));
      } else if (prepare.phase === "cancelled") {
        children.push(React.createElement("p", { className: "dwmc-warn", key: "cancelled" }, t.cancelled));
      } else if (prepare.phase === "ok" && !compact) {
        children.push(React.createElement("p", { className: "dwmc-note", key: "ok" }, installed ? t.ready : t.ok));
        if (prepare.bridge && prepare.bridge.ok === true && prepare.bridge.restartRequired === true) {
          children.push(React.createElement("p", { className: "dwmc-note", key: "restart" }, t.restart));
        }
      } else if (installed && !compact) {
        children.push(React.createElement("p", { className: "dwmc-note", key: "ready" }, t.ready));
      } else if (!installed && !running) {
        children.push(React.createElement("p", { className: "dwmc-note", key: "estimate" }, t.estimate));
      }
      if (!compact && (running || updateAvailable)) {
        children.push(React.createElement("p", { className: "dwmc-note", key: "updateHint" }, t.updateHint));
      }
      if (view.phase === "error") {
        children.push(React.createElement("p", { className: "dwmc-error", key: "offline" }, t.hostDown + ": " + view.error));
      }

      var actions = [];
      if (running) {
        actions.push(actionButton(t.cancel, function () { actUpdate({ action: "cancel" }); }, busy, true));
      } else {
        actions.push(
          actionButton(
            check.phase === "checking" ? t.checking : t.check,
            function () { actUpdate({ action: "check" }); },
            busy,
            true,
          ),
        );
        if (updateAvailable) {
          actions.push(
            actionButton(
              t.updateTo + " v" + check.latest,
              function () { actUpdate({ action: "install", version: check.latest }); },
              busy,
            ),
          );
        }
        if (typeof versions.previous === "string") {
          actions.push(
            actionButton(
              t.rollback + " v" + versions.previous,
              function () { actUpdate({ action: "rollback" }); },
              busy,
              true,
            ),
          );
        }
        if (!installed) actions.push(actionButton(t.install, function () { act(PREPARE_PATH); }, busy));
        else actions.push(actionButton(t.reinstall, function () { act(PREPARE_PATH); }, busy, true));
        if (prepare.bridge && prepare.bridge.ok !== true) {
          actions.push(actionButton(t.pointBridge, function () { act(BRIDGE_PATH); }, busy, true));
        }
      }
      children.push(React.createElement("div", { className: "dwmc-actions", key: "actions" }, actions));

      return React.createElement("section", { className: "dwmc-panel" }, children);
    }

    /** The short prompt shown after the bundle is enabled. */
    function WindowsMcpSetupPrompt() {
      return React.createElement(WindowsMcpPanel, { __compact: true });
    }

    /* ------------------------------------------------------------------ *
     * registration
     * ------------------------------------------------------------------ */

    /** The composer pill: a session-scoped list slot. */
    function registerComposerPill(ctx) {
      try {
        ctx.slots.inject(SLOT_NAME, function () {
          return ctx.slots.register(
            {
              name: SLOT_NAME,
              id: ENTRY_ID,
              order: ENTRY_ORDER,
              label: function () {
                return LABEL;
              },
              inject: function (sessionId) {
                return { sessionId: sessionId };
              },
            },
            function SlotComponent(props) {
              return React.createElement(ComputerUsePill, Object.assign({}, props, { __ctx: ctx }));
            },
          );
        });
      } catch (error) {
        // A failed registration only means the pill is missing; never break the composer.
        try {
          console.error("[" + PACKAGE_ID + "] composer pill registration failed:", error);
        } catch (ignored) {
          /* nothing to do */
        }
      }
    }

    /**
     * The bundle's own page inside Settings → Plugins. `key` is this package's
     * name, which is what the shipped plugin manager dispatches these keyed slots
     * with — the same two slots the official experimental bundles use.
     */
    function registerBundleSlots(ctx) {
      var entries = [
        ["plugins.bundle.config", WindowsMcpPanel],
        ["plugins.bundle.activation", WindowsMcpSetupPrompt],
      ];
      for (var index = 0; index < entries.length; index += 1) {
        var name = entries[index][0];
        var Component = entries[index][1];
        try {
          ctx.slots.inject(name, function (slotName, SlotComponent) {
            return function () {
              return ctx.slots.register(
                {
                  name: slotName,
                  key: PACKAGE_ID,
                  label: function () {
                    return LABEL;
                  },
                },
                SlotComponent,
              );
            };
          }(name, Component));
        } catch (error) {
          try {
            console.error("[" + PACKAGE_ID + "] " + name + " registration failed:", error);
          } catch (ignored) {
            /* nothing to do */
          }
        }
      }
    }

    /**
     * @param ctx - client cordis context.
     */
    function apply(ctx) {
      installStyles();
      registerComposerPill(ctx);
      registerBundleSlots(ctx);
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = { CSS: CSS, apiUrl: apiUrl, tooltipFor: tooltipFor, LABEL: LABEL, STATE_PATH: STATE_PATH, UPDATE_PATH: UPDATE_PATH };
    return module.exports;
  },
});
