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
    var SETTINGS_PATH = "/dsh-windows-mcp/settings";
    var SETTINGS_SLOT = "settings.section";
    var SETTINGS_ENTRY_ID = "windows-mcp-settings";
    var SETTINGS_ORDER = 62;
    var SETTINGS_NAV_ICON_MARKER = "data-dwmc-nav-icon";
    var SETTINGS_NAV_ICON_STYLE_ID = PACKAGE_ID + "-settings-nav-icon-styles";
    var SETTINGS_NAV_ROW_SELECTOR = '[role="dialog"] nav button';
    var REPO_URL = "https://github.com/helloHub1212/dsh-windows-mcp";
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
      /* Panel chrome: the plugin card, the settings dependency card and the prompt. */
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
      /* Settings page: plain cards, one control per row, theme tokens only. */
      ".dwmc-set{display:flex;flex-direction:column;gap:18px;max-width:720px;",
      "color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}",
      ".dwmc-set__head{display:flex;flex-direction:column;gap:4px}",
      ".dwmc-set__title{margin:0;font-size:16px;font-weight:600}",
      ".dwmc-set__sub{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".dwmc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;",
      "background:var(--dsw-alias-bg-layer-1);padding:14px 16px;display:flex;flex-direction:column;gap:12px}",
      ".dwmc-card__title{margin:0;font-size:13px;font-weight:600}",
      ".dwmc-field{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}",
      ".dwmc-field__label{display:flex;flex-direction:column;gap:2px;min-width:180px}",
      ".dwmc-field__hint{font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".dwmc-input,.dwmc-select{font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);",
      "background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);",
      "border-radius:8px;padding:5px 8px;min-width:120px}",
      ".dwmc-input:focus-visible,.dwmc-select:focus-visible{outline:2px solid",
      "color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);outline-offset:1px}",
      ".dwmc-checks{display:flex;flex-wrap:wrap;gap:6px 14px}",
      ".dwmc-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;",
      "color:var(--dsw-alias-label-primary);cursor:pointer}",
      ".dwmc-check input{accent-color:var(--dsw-alias-brand-primary);margin:0}",
      ".dwmc-set__actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      ".dwmc-star{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 14px;font:inherit;",
      "font-size:12px;cursor:pointer;border-radius:8px;border:1px solid transparent;background:transparent;",
      "color:var(--dsw-alias-brand-primary);",
      "box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent)}",
      ".dwmc-star:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}",
      ".dwmc-star svg{width:14px;height:14px;display:block}",
      ".dwmc-saved{font-size:12px;color:var(--dsw-alias-state-success-primary)}",
      /* The dependency section: the panel body folded into a settings card. */
      ".dwmc-dep{display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.55}",
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
      // True while a write is in flight: the poller stays quiet so an
      // optimistic toggle is not overwritten by a stale read.
      var busyRef = React.useRef(false);

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
        // The host flag also moves without this pill: the settings page, an
        // installer run, or a second window. Re-read on a timer and whenever
        // the window regains focus so the switch never shows a stale position.
        if (typeof window === "undefined" || typeof window.setInterval !== "function") return undefined;
        var refresh = function () {
          if (!busyRef.current) load();
        };
        var timer = window.setInterval(refresh, 4000);
        var hasListeners = typeof window.addEventListener === "function";
        if (hasListeners) window.addEventListener("focus", refresh);
        return function () {
          window.clearInterval(timer);
          if (hasListeners) window.removeEventListener("focus", refresh);
        };
      }, [load]);

      var toggle = React.useCallback(function () {
        if (view.phase === "loading" || view.busy) return;
        var next = !view.enabled;
        busyRef.current = true;
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
              busyRef.current = false;
              setView({
                phase: "ready",
                enabled: body && body.enabled === true,
                bridged: typeof (body && body.bridged) === "number" ? body.bridged : view.bridged,
                busy: false,
                error: null,
              });
            })
            .catch(function (error) {
              busyRef.current = false;
              setView({
                phase: "ready",
                enabled: !next,
                bridged: view.bridged,
                busy: false,
                error: String(error && error.message ? error.message : error),
              });
            });
        } catch (error) {
          busyRef.current = false;
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
        settingsTitle: "Windows-MCP 参数",
        settingsNav: "桌面控制",
        settingsSub: "调整桥接与更新行为；桥接参数写入配置后需要重启 DSH 才生效。",
        settingsRestart: "桥接参数已写入配置，重启 DSH 后生效。",
        settingsSaved: "已保存",
        settingsSave: "保存",
        settingsSaving: "保存中…",
        settingsRevert: "还原",
        settingsFailed: "保存失败",
        settingsIgnored: "部分取值无效，已回退为默认值：",
        bundleHint: "安装、更新和回退都在 设置 → 桌面控制 里管理。",
        sectionDependency: "依赖（Windows-MCP）",
        sectionBridge: "桥接（重启 DSH 生效）",
        sectionUpdates: "更新与镜像",
        sectionAbout: "关于",
        timeoutLabel: "工具调用超时",
        timeoutHint: "毫秒，5000–600000。越长越不容易被中断，卡住时也等得越久。",
        scaleLabel: "截图缩放",
        scaleHint: "越小越省视觉 token，细节也越少。",
        backendLabel: "截图后端",
        backendHint: "auto 交给上游挑；dxcam 最快，pillow 最慢但最稳。",
        flashLabel: "截图闪光边框",
        flashHint: "关掉可少一次桌面重绘；默认关闭。",
        excludeLabel: "屏蔽的工具",
        excludeHint: "屏蔽的工具不会出现在模型工具表里，能省上下文。",
        autoCheckLabel: "启动时检查更新",
        autoCheckHint: "每次启动后台查一次最新版，结果缓存 6 小时。",
        mirrorLabel: "首选镜像",
        mirrorHint: "auto 用测速最快的镜像；固定某个可避开波动。",
        starLabel: "点个 star",
        starHint: "觉得有用就给个 star，插件会继续维护。",
        aboutRepo: "仓库",
        aboutVersion: "版本",
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
        settingsTitle: "Windows-MCP settings",
        settingsNav: "Desktop",
        settingsSub: "Tune the bridge and the update behaviour. Bridge values apply after a DSH restart.",
        settingsRestart: "Bridge values were written to the patch layer — restart DSH to apply them.",
        settingsSaved: "Saved",
        settingsSave: "Save",
        settingsSaving: "Saving…",
        settingsRevert: "Revert",
        settingsFailed: "Could not save",
        settingsIgnored: "Some values were invalid and fell back to the defaults:",
        bundleHint: "Install, update and roll back in Settings → Desktop.",
        sectionDependency: "Dependency (Windows-MCP)",
        sectionBridge: "Bridge (applies after a DSH restart)",
        sectionUpdates: "Updates and mirrors",
        sectionAbout: "About",
        timeoutLabel: "Tool call timeout",
        timeoutHint: "Milliseconds, 5000–600000. Longer waits are interrupted less often, and stall longer when something hangs.",
        scaleLabel: "Screenshot scale",
        scaleHint: "Smaller costs fewer vision tokens and shows less detail.",
        backendLabel: "Screenshot backend",
        backendHint: "auto lets the server choose; dxcam is fastest, pillow slowest but most compatible.",
        flashLabel: "Screenshot flash border",
        flashHint: "Turning it off saves one desktop repaint; off by default.",
        excludeLabel: "Hidden tools",
        excludeHint: "Hidden tools stay out of the model's tool table, which saves context.",
        autoCheckLabel: "Check for updates at boot",
        autoCheckHint: "One background check per boot, cached for six hours.",
        mirrorLabel: "Preferred mirror",
        mirrorHint: "auto uses the fastest probe; pinning one avoids jitter.",
        starLabel: "Star on GitHub",
        starHint: "If it helps, a star keeps the plugin maintained.",
        aboutRepo: "Repository",
        aboutVersion: "Version",
      },
    };

    function copy() {
      try {
        return String(navigator.language || "").toLowerCase().indexOf("zh") === 0 ? COPY.zh : COPY.en;
      } catch (error) {
        return COPY.en;
      }
    }

    /** GET /state on a timer; the plugin card and the settings page mount this. */
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
      // Inside the settings page the panel is one card among several: the card
      // already carries the title, so the panel only contributes its body.
      var embedded = props !== null && props !== undefined && props.__embedded === true;
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

      var children = embedded ? [] : [head];
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

      if (embedded) return React.createElement("div", { className: "dwmc-dep" }, children);
      return React.createElement("section", { className: "dwmc-panel" }, children);
    }

    /** The short prompt shown after the bundle is enabled. */
    function WindowsMcpSetupPrompt() {
      return React.createElement(WindowsMcpPanel, { __compact: true });
    }

    /**
     * What the plugin's own page keeps: a one-line status plus a pointer to the
     * page that now owns installs. The controls moved to Settings → Desktop so
     * there is exactly one place to manage the dependency.
     */
    function WindowsMcpBundleNote() {
      var t = copy();
      var triple = useHostState(8000);
      var view = triple[0];
      var state = view.state || {};
      var dependency = state.dependency || {};
      var installed = dependency.installed === true;
      return React.createElement(
        "section",
        { className: "dwmc-panel" },
        React.createElement(
          "div",
          { className: "dwmc-panel__head", key: "head" },
          statusDot(installed ? "on" : "warn"),
          React.createElement("span", null, t.title),
        ),
        React.createElement(
          "p",
          { className: "dwmc-note", key: "hint" },
          installed
            ? t.installed + (dependency.version ? " " + dependency.version : "") + " · " + t.bundleHint
            : t.bundleHint,
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * settings page
     * ------------------------------------------------------------------ */

    var SCALE_CHOICES = [0.25, 0.5, 0.75, 1];
    var BACKEND_CHOICES = ["auto", "dxcam", "mss", "pillow"];
    var MIRROR_CHOICES = ["auto", "ustc", "aliyun", "tencent", "huawei", "nju", "tuna", "pypi"];
    var EXCLUDE_CHOICES = ["App", "PowerShell", "FileSystem"];

    /** A mutable copy of the host settings, so a form never edits state in place. */
    function cloneSettings(input) {
      var bridge = input && input.bridge ? input.bridge : {};
      var plugin = input && input.plugin ? input.plugin : {};
      return {
        bridge: {
          toolCallTimeoutMs: Number(bridge.toolCallTimeoutMs),
          excludeTools: Array.isArray(bridge.excludeTools) ? bridge.excludeTools.slice() : [],
          screenshotScale: Number(bridge.screenshotScale),
          screenshotBackend: String(bridge.screenshotBackend || "auto"),
          disableFlash: bridge.disableFlash === true,
        },
        plugin: {
          autoCheckUpdates: plugin.autoCheckUpdates === true,
          preferredMirror: String(plugin.preferredMirror || "auto"),
        },
      };
    }

    /** GET/POST the host settings; only the settings page mounts this. */
    function useSettings() {
      var pair = React.useState({ phase: "loading", view: null, error: null });
      var view = pair[0];
      var setView = pair[1];
      var savedPair = React.useState({ phase: "idle", body: null, error: null });
      var saved = savedPair[0];
      var setSaved = savedPair[1];

      var load = React.useCallback(function () {
        return fetch(apiUrl(SETTINGS_PATH), { headers: { accept: "application/json" } })
          .then(function (response) {
            return response.json();
          })
          .then(function (body) {
            setView({ phase: "ready", view: body, error: null });
            return body;
          })
          .catch(function (error) {
            setView({ phase: "error", view: null, error: String(error && error.message ? error.message : error) });
          });
      }, []);

      React.useEffect(
        function () {
          load();
        },
        [load],
      );

      var save = React.useCallback(function (next) {
        setSaved({ phase: "saving", body: null, error: null });
        return fetch(apiUrl(SETTINGS_PATH), {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ settings: next }),
        })
          .then(function (response) {
            return response.json();
          })
          .then(function (body) {
            setView({ phase: "ready", view: body, error: null });
            setSaved({ phase: body && body.ok === false ? "error" : "saved", body: body, error: null });
            return body;
          })
          .catch(function (error) {
            setSaved({ phase: "error", body: null, error: String(error && error.message ? error.message : error) });
            return null;
          });
      }, []);

      return { view: view, saved: saved, save: save, reload: load };
    }

    function starIcon() {
      return React.createElement(
        "svg",
        { viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true" },
        React.createElement("path", {
          d: "M8 1.2l2.06 4.18 4.61.67-3.34 3.25.79 4.6L8 11.73l-4.12 2.17.79-4.6L1.33 6.05l4.61-.67z",
        }),
      );
    }

    /** Settings → left rail: the plugin's parameter page. */
    function SettingsPage() {
      var t = copy();
      var host = useSettings();
      var view = host.view;
      var draftPair = React.useState(null);
      var draft = draftPair[0];
      var setDraft = draftPair[1];

      var ready = view.phase === "ready" && view.view && view.view.settings ? view.view : null;

      React.useEffect(
        function () {
          if (ready !== null) setDraft(cloneSettings(ready.settings));
        },
        [ready === null ? null : JSON.stringify(ready.settings)],
      );

      if (view.phase === "loading") return React.createElement("p", { className: "dwmc-note" }, t.checking);
      if (view.phase === "error") return React.createElement("p", { className: "dwmc-error" }, t.hostDown + " — " + String(view.error || ""));
      if (draft === null || ready === null) return React.createElement("p", { className: "dwmc-note" }, t.checking);

      var dirty = JSON.stringify(draft) !== JSON.stringify(cloneSettings(ready.settings));
      var saving = host.saved.phase === "saving";

      var update = function (section, key, value) {
        var next = cloneSettings(draft);
        next[section][key] = value;
        setDraft(next);
      };
      var toggleExclude = function (name) {
        var next = cloneSettings(draft);
        var at = next.bridge.excludeTools.indexOf(name);
        if (at === -1) next.bridge.excludeTools.push(name);
        else next.bridge.excludeTools.splice(at, 1);
        setDraft(next);
      };
      var save = function () {
        host.save(draft).then(function (body) {
          if (body && body.settings) setDraft(cloneSettings(body.settings));
        });
      };

      var field = function (label, hint, control) {
        return React.createElement(
          "div",
          { className: "dwmc-field", key: label },
          React.createElement(
            "div",
            { className: "dwmc-field__label" },
            React.createElement("span", null, label),
            hint ? React.createElement("span", { className: "dwmc-field__hint" }, hint) : null,
          ),
          control,
        );
      };
      var check = function (label, checked, onChange, key) {
        return React.createElement(
          "label",
          { className: "dwmc-check", key: key || label },
          React.createElement("input", { type: "checkbox", checked: checked === true, onChange: function (event) { onChange(event.target.checked); } }),
          label,
        );
      };
      var card = function (title, children) {
        return React.createElement(
          "section",
          { className: "dwmc-card" },
          React.createElement("h3", { className: "dwmc-card__title" }, title),
          children,
        );
      };

      var dependencyCard = card(t.sectionDependency, React.createElement(WindowsMcpPanel, { __embedded: true }));

      var bridgeCard = card(t.sectionBridge, [
        field(
          t.timeoutLabel,
          t.timeoutHint,
          React.createElement("input", {
            className: "dwmc-input",
            type: "number",
            min: 5000,
            max: 600000,
            step: 1000,
            value: String(draft.bridge.toolCallTimeoutMs),
            onChange: function (event) {
              update("bridge", "toolCallTimeoutMs", Number(event.target.value));
            },
          }),
        ),
        field(
          t.scaleLabel,
          t.scaleHint,
          React.createElement(
            "select",
            {
              className: "dwmc-select",
              value: String(draft.bridge.screenshotScale),
              onChange: function (event) {
                update("bridge", "screenshotScale", Number(event.target.value));
              },
            },
            SCALE_CHOICES.map(function (scale) {
              return React.createElement("option", { key: String(scale), value: String(scale) }, String(scale));
            }),
          ),
        ),
        field(
          t.backendLabel,
          t.backendHint,
          React.createElement(
            "select",
            {
              className: "dwmc-select",
              value: draft.bridge.screenshotBackend,
              onChange: function (event) {
                update("bridge", "screenshotBackend", event.target.value);
              },
            },
            BACKEND_CHOICES.map(function (backend) {
              return React.createElement("option", { key: backend, value: backend }, backend);
            }),
          ),
        ),
        field(
          t.flashLabel,
          t.flashHint,
          React.createElement("input", {
            type: "checkbox",
            checked: draft.bridge.disableFlash === false ? false : true,
            onChange: function (event) {
              update("bridge", "disableFlash", event.target.checked);
            },
          }),
        ),
        field(
          t.excludeLabel,
          t.excludeHint,
          React.createElement(
            "div",
            { className: "dwmc-checks" },
            EXCLUDE_CHOICES.map(function (name) {
              return check(name, draft.bridge.excludeTools.indexOf(name) !== -1, function () { toggleExclude(name); }, name);
            }),
          ),
        ),
      ]);

      var updatesCard = card(t.sectionUpdates, [
        field(
          t.autoCheckLabel,
          t.autoCheckHint,
          React.createElement("input", {
            type: "checkbox",
            checked: draft.plugin.autoCheckUpdates === true,
            onChange: function (event) {
              update("plugin", "autoCheckUpdates", event.target.checked);
            },
          }),
        ),
        field(
          t.mirrorLabel,
          t.mirrorHint,
          React.createElement(
            "select",
            {
              className: "dwmc-select",
              value: draft.plugin.preferredMirror,
              onChange: function (event) {
                update("plugin", "preferredMirror", event.target.value);
              },
            },
            MIRROR_CHOICES.map(function (mirror) {
              return React.createElement("option", { key: mirror, value: mirror }, mirror);
            }),
          ),
        ),
      ]);

      var notes = [];
      if (host.saved.phase === "saved") notes.push(React.createElement("span", { key: "saved", className: "dwmc-saved" }, t.settingsSaved));
      if (host.saved.phase === "error") notes.push(React.createElement("span", { key: "err", className: "dwmc-error" }, t.settingsFailed));
      if (ready.restartRequired && host.saved.phase !== "saving") {
        notes.push(React.createElement("span", { key: "restart", className: "dwmc-warn" }, t.settingsRestart));
      }
      if (host.saved.body && Array.isArray(host.saved.body.problems) && host.saved.body.problems.length > 0) {
        notes.push(React.createElement("span", { key: "ignored", className: "dwmc-warn" }, t.settingsIgnored + " " + host.saved.body.problems.join(", ")));
      }

      var aboutCard = card(t.sectionAbout, [
        React.createElement(
          "div",
          { className: "dwmc-rows" },
          React.createElement("dt", null, t.aboutVersion),
          React.createElement("dd", { className: "dwmc-mono" }, "v" + String(ready.pluginVersion || "?")),
          React.createElement("dt", null, t.aboutRepo),
          React.createElement(
            "dd",
            null,
            React.createElement("a", { className: "dwmc-mono", href: REPO_URL, target: "_blank", rel: "noopener noreferrer" }, REPO_URL.replace("https://", "")),
          ),
        ),
        React.createElement(
          "div",
          { className: "dwmc-set__actions" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "dwmc-star",
              onClick: function () {
                try {
                  window.open(REPO_URL, "_blank", "noopener,noreferrer");
                } catch (error) {
                  /* a blocked popup is not worth failing the page over */
                }
              },
            },
            starIcon(),
            t.starLabel,
          ),
          React.createElement("span", { className: "dwmc-note" }, t.starHint),
        ),
      ]);

      return React.createElement(
        "div",
        { className: "dwmc-set" },
        React.createElement(
          "div",
          { className: "dwmc-set__head" },
          React.createElement("h2", { className: "dwmc-set__title" }, t.settingsTitle),
          React.createElement("p", { className: "dwmc-set__sub" }, t.settingsSub),
        ),
        dependencyCard,
        bridgeCard,
        updatesCard,
        aboutCard,
        React.createElement(
          "div",
          { className: "dwmc-set__actions" },
          React.createElement(
            "button",
            { type: "button", className: "dwmc-btn", onClick: save, disabled: saving || !dirty },
            saving ? t.settingsSaving : t.settingsSave,
          ),
          React.createElement(
            "button",
            { type: "button", className: "dwmc-btn dwmc-btn--quiet", onClick: function () { setDraft(cloneSettings(ready.settings)); }, disabled: saving || !dirty },
            t.settingsRevert,
          ),
          notes.length > 0 ? React.createElement("span", { className: "dwmc-set__actions" }, notes) : null,
        ),
      );
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
        // The plugin's own page keeps a pointer; installs live in Settings → Desktop.
        ["plugins.bundle.config", WindowsMcpBundleNote],
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
     * Settings → left rail. `settings.section` is a list slot: one page per
     * registered entry, ordered by `order`, labelled by `label()`.
     */
    /**
     * The glyph of the settings entry: a monitor with a cursor cut out of its
     * screen ("this page drives the desktop"). `settings.section` has no icon
     * field, so the entry is painted on the shell's nav row: the row is marked
     * by matching its visible text against our own localized label, the shell's
     * gear is hidden and a mask-image painted in `currentColor` takes its place.
     */
    function settingsNavMaskSvg() {
      return [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="#000">',
        '<path fill-rule="evenodd" d="M2.6 2.6h10.8c.66 0 1.2.54 1.2 1.2v6.4c0 .66-.54 1.2-1.2 1.2H2.6',
        'c-.66 0-1.2-.54-1.2-1.2V3.8c0-.66.54-1.2 1.2-1.2Zm3.1 2.5 4.5 2.85-2.1.36.98 2.06-1.16.55',
        '-0.97-2.05-1.3 1.05z"/>',
        '<rect x="7" y="11.2" width="2" height="1.7" rx=".3"/>',
        '<rect x="5.2" y="12.9" width="5.6" height="1.4" rx=".7"/>',
        "</svg>",
      ].join("");
    }

    /** Encoded as a CSS `mask-image` source; the mask reads alpha only. */
    function settingsNavMaskUrl(svg) {
      var source = typeof svg === "string" ? svg : settingsNavMaskSvg();
      return "data:image/svg+xml," + encodeURIComponent(source).replace(/'/gu, "%27");
    }

    /**
     * Whether a nav row is this plugin's own. Pure: the row whose visible text
     * is the label the shell currently projects, trimmed. An empty label matches
     * nothing, so a locale that has not resolved yet never marks the whole nav.
     */
    function isOwnSettingsNavRow(rowText, wantedLabel) {
      var wanted = String(wantedLabel === null || wantedLabel === undefined ? "" : wantedLabel).trim();
      if (wanted.length === 0) return false;
      return String(rowText === null || rowText === undefined ? "" : rowText).trim() === wanted;
    }

    /** Stylesheet for the marked row: hide the shell icon, draw ours. */
    function settingsNavIconCss(maskUrl) {
      var marker = "[" + SETTINGS_NAV_ICON_MARKER + "]";
      return [
        marker + " > svg{display:none}",
        marker + "::before{content:'';flex:none;width:16px;height:16px;",
        "background-color:currentColor;",
        "-webkit-mask-image:url('" + maskUrl + "');mask-image:url('" + maskUrl + "');",
        "-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;",
        "-webkit-mask-position:center;mask-position:center;",
        "-webkit-mask-size:16px 16px;mask-size:16px 16px}",
      ].join("");
    }

    /**
     * Install the nav glyph. Idempotent, and a no-op outside a browser. The
     * observer follows re-renders and locale switches, so the text and the
     * glyph can never disagree; the marker and the stylesheet belong to the
     * fiber when the client context offers `effect`.
     */
    function installSettingsNavIcon(ctx) {
      if (typeof document === "undefined" || typeof MutationObserver !== "function") return null;
      var install = function () {
        var existing = document.getElementById(SETTINGS_NAV_ICON_STYLE_ID);
        if (existing !== null) return function () {};
        var style = document.createElement("style");
        style.id = SETTINGS_NAV_ICON_STYLE_ID;
        style.textContent = settingsNavIconCss(settingsNavMaskUrl());
        document.head.appendChild(style);
        var disposed = false;
        var scheduled = false;
        var sync = function () {
          scheduled = false;
          if (disposed) return;
          var wanted = copy().settingsNav;
          var rows = document.querySelectorAll(SETTINGS_NAV_ROW_SELECTOR);
          for (var index = 0; index < rows.length; index += 1) {
            var row = rows[index];
            if (isOwnSettingsNavRow(row.textContent, wanted)) row.setAttribute(SETTINGS_NAV_ICON_MARKER, "");
            else row.removeAttribute(SETTINGS_NAV_ICON_MARKER);
          }
        };
        var schedule = function () {
          if (scheduled || disposed) return;
          scheduled = true;
          if (typeof queueMicrotask === "function") queueMicrotask(sync);
          else setTimeout(sync, 0);
        };
        sync();
        var observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        return function () {
          disposed = true;
          observer.disconnect();
          var marked = document.querySelectorAll("[" + SETTINGS_NAV_ICON_MARKER + "]");
          for (var at = 0; at < marked.length; at += 1) marked[at].removeAttribute(SETTINGS_NAV_ICON_MARKER);
          if (style.parentNode !== null) style.parentNode.removeChild(style);
        };
      };
      if (ctx && typeof ctx.effect === "function") return ctx.effect(install, "dsh-windows-mcp: settings nav icon");
      return install();
    }

    function registerSettingsSection(ctx) {
      try {
        ctx.slots.inject(SETTINGS_SLOT, function () {
          return ctx.slots.register(
            {
              name: SETTINGS_SLOT,
              id: SETTINGS_ENTRY_ID,
              order: SETTINGS_ORDER,
              label: function () {
                return copy().settingsNav;
              },
            },
            function SettingsSection() {
              return React.createElement(SettingsPage, null);
            },
          );
        });
      } catch (error) {
        try {
          console.error("[" + PACKAGE_ID + "] settings section registration failed:", error);
        } catch (ignored) {
          /* nothing to do */
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
      registerSettingsSection(ctx);
      installSettingsNavIcon(ctx);
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = {
      CSS: CSS,
      apiUrl: apiUrl,
      tooltipFor: tooltipFor,
      LABEL: LABEL,
      STATE_PATH: STATE_PATH,
      UPDATE_PATH: UPDATE_PATH,
      SETTINGS_PATH: SETTINGS_PATH,
      REPO_URL: REPO_URL,
      SETTINGS_SLOT: SETTINGS_SLOT,
      SETTINGS_NAV_ICON: settingsNavMaskSvg(),
      SETTINGS_NAV_ICON_MARKER: SETTINGS_NAV_ICON_MARKER,
      isOwnSettingsNavRow: isOwnSettingsNavRow,
      settingsNavIconCss: settingsNavIconCss,
      settingsNavMaskUrl: settingsNavMaskUrl,
      cloneSettings: cloneSettings,
      SettingsPage: SettingsPage,
      WindowsMcpPanel: WindowsMcpPanel,
      WindowsMcpBundleNote: WindowsMcpBundleNote,
    };
    return module.exports;
  },
});
