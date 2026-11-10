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
    var SETTINGS_NAV_ICON_SLOT = "settings.section.icon";
    var REPO_URL = "https://github.com/helloHub1212/dsh-windows-mcp";
    var STYLE_ID = PACKAGE_ID + "-computer-use-styles";
    /** Only `slots` is injected: it is certainly provided, and a declaration for
     *  a service nobody provides would leave this plugin's fiber pending. */
    var inject = ["slots"];
    /** The host's `locale` service, resolved in `apply()`. Optional: the plugin
     *  still renders (from the browser language) when it is absent. */
    var hostLocale = null;

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
      /* The welcome surface: a modal scrim over the whole window. The card is a
         glass sheet — the scrim carries the shell's mask tokens, so the dialog
         reads as chrome rather than as a box inside the plugin page. */
      ".dwmc-host{display:contents}",
      "@keyframes dwmc-fadein{from{opacity:0}to{opacity:1}}",
      "@keyframes dwmc-rise{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}",
      ".dwmc-scrim{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;",
      "justify-content:center;padding:24px;box-sizing:border-box;",
      "background:var(--dsw-alias-bg-mask-1,rgb(0 0 0 / 32%));",
      "backdrop-filter:var(--dsw-mask-blur,blur(8px)) saturate(140%);",
      "-webkit-backdrop-filter:var(--dsw-mask-blur,blur(8px)) saturate(140%);",
      "animation:dwmc-fadein .2s ease}",
      ".dwmc-dialog{position:relative;width:min(460px,100%);max-height:calc(100vh - 48px);overflow:auto;",
      "box-sizing:border-box;padding:24px 24px 20px;border-radius:18px;",
      "color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6;",
      "background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 70%,transparent);",
      "backdrop-filter:blur(18px) saturate(155%);-webkit-backdrop-filter:blur(18px) saturate(155%);",
      "border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 78%,transparent);",
      "box-shadow:inset 0 1px 0 rgb(255 255 255 / 7%),0 24px 64px rgb(0 0 0 / 28%);",
      "outline:none;animation:dwmc-rise .28s cubic-bezier(.16,1,.3,1)}",
      ".dwmc-dialog__eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;",
      "color:var(--dsw-alias-label-secondary);margin-bottom:8px}",
      ".dwmc-dialog__title{margin:0 0 8px;font-size:19px;font-weight:650;line-height:1.35;letter-spacing:-.01em}",
      ".dwmc-dialog__lead{margin:0 0 16px;color:var(--dsw-alias-label-secondary)}",
      ".dwmc-dialog__list{list-style:none;margin:0 0 20px;padding:0;display:flex;flex-direction:column;gap:9px}",
      ".dwmc-dialog__list li{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:11px;",
      "background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 62%,transparent);",
      "border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 70%,transparent)}",
      ".dwmc-dialog__list b{font-weight:600}",
      ".dwmc-dialog__list span{color:var(--dsw-alias-label-secondary)}",
      ".dwmc-dialog__actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}",
      /* Both actions are the same size; only the star carries colour. */
      ".dwmc-dialog__actions .dwmc-btn,.dwmc-dialog__actions .dwmc-star{height:34px;padding:0 18px;",
      "font-size:13px;font-weight:600;border-radius:10px}",
      ".dwmc-star--hero{color:rgb(255 255 255);",
      "border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 78%,rgb(0 0 0));",
      "background:linear-gradient(180deg,",
      "color-mix(in srgb,var(--dsw-alias-brand-primary) 82%,rgb(255 255 255)) 0%,",
      "color-mix(in srgb,var(--dsw-alias-brand-primary) 96%,rgb(0 0 0)) 100%);",
      "box-shadow:inset 0 1px 0 rgb(255 255 255 / 24%),",
      "0 6px 18px color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}",
      ".dwmc-star--hero:hover{background:linear-gradient(180deg,",
      "color-mix(in srgb,var(--dsw-alias-brand-primary) 88%,rgb(255 255 255)) 0%,",
      "color-mix(in srgb,var(--dsw-alias-brand-primary) 90%,rgb(0 0 0)) 100%)}",
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

    /** Fill `{name}` placeholders in a copy template. */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, function (match, key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
      });
    }

    /** Tooltip copy: state first, then what the switch does, then any failure. */
    function tooltipFor(view) {
      var t = copy();
      var head;
      if (view.phase === "loading") head = t.pillChecking;
      else if (view.phase === "error") head = fill(t.pillError, { error: view.error });
      else if (!view.enabled) head = t.pillOff;
      else if (view.bridged === 0) head = t.pillNoTools;
      else if (typeof view.bridged === "number") head = fill(t.pillOn, { count: view.bridged });
      else head = t.pillOnPlain;
      return (
        head +
        "\n" +
        t.pillAllow +
        "\n" +
        t.pillDeny +
        "\n" +
        (view.phase === "ready" || view.phase === "loading" ? t.pillToggle : t.pillRetry)
      );
    }

    /** The pill itself. */
    function ComputerUsePill() {
      var triple = useComputerUse();
      var view = triple[0];
      var toggle = triple[1];
      var reload = triple[2];

      // A language switch in DSH must repaint the pill at once; the 4s host
      // poll would only catch it on the next tick. The service is optional.
      var localePair = React.useState(0);
      var setLocaleVersion = localePair[1];
      React.useEffect(function () {
        var service = hostLocale;
        if (!service || typeof service.subscribe !== "function") return undefined;
        try {
          return service.subscribe(function () {
            setLocaleVersion(function (version) {
              return version + 1;
            });
          });
        } catch (error) {
          return undefined;
        }
      }, []);

      var t = copy();
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
          "aria-label": t.pillLabel,
          title: tooltipFor(view),
          onClick: onClick,
        },
        React.createElement("span", { className: "dwmc-dot" }),
        screenIcon(),
        React.createElement("span", { className: "dwmc-label" }, t.pillLabel),
      );
    }

    /* ------------------------------------------------------------------ *
     * dependency panel — Settings → Plugins → this bundle
     * ------------------------------------------------------------------ */

    /** Bilingual copy, chosen from the browser language. */
    var COPY = {
      zh: {
        title: "Windows 桌面自动化（Windows-MCP）",
        pillLabel: "AI 控制电脑",
        pillChecking: "AI 控制权 · 检测中…",
        pillError: "AI 控制权 · 无法连接宿主（{error}）",
        pillOff: "AI 未获得控制权 · 桌面工具对模型隐藏，调用会被拒绝",
        pillNoTools: "AI 有控制权，但尚无可用工具 · 请检查依赖是否已安装",
        pillOn: "AI 正在控制这台电脑 · {count} 个桌面工具可用",
        pillOnPlain: "AI 正在控制这台电脑",
        pillAllow: "允许 agent 操作这台电脑的桌面（截屏、点击、输入、剪贴板、进程、注册表），由 Windows-MCP 提供。",
        pillDeny: "关闭后这些工具会从模型眼前隐藏，调用也会被拒绝。",
        pillToggle: "点击切换",
        pillRetry: "点击重试",
        dependency: "依赖",
        installed: "已安装",
        missing: "未安装",
        uvMissing: "未找到 uv",
        tool: "可执行文件",
        bridge: "桥",
        bridgedTools: "个工具已注册",
        profile: "写入目标",
        profileAmbiguous: "检测到多个已装本插件的 profile，写入前请在本机设置 DSH_WINDOWS_MCP_PROFILE",
        toggle: "AI 控制电脑开关",
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
        sectionTools: "工具暴露",
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
        lazyLabel: "惰性工具（省 token）",
        lazyHint: "平时只给模型一个入口，调用它之后才把桌面工具的定义发过去；关掉则每一步都带上全部工具表。",
        welcomeTitle: "欢迎使用 DSH 桌面控制插件",
        welcomeLead: "模型现在可以在你允许时截屏、点击、输入和管理窗口 —— 默认关闭，随时可在输入框工具行打开。",
        welcomeDeps: "依赖安装 / 更新、版本回退",
        welcomeDepsWhere: "设置 → 桌面控制 → 「依赖」",
        welcomeParams: "参数调整（截图缩放、超时、镜像、惰性工具）",
        welcomeParamsWhere: "设置 → 桌面控制",
        welcomeSwitch: "AI 控制电脑开关",
        welcomeSwitchWhere: "输入框工具行；关闭时所有桌面工具对模型不可见",
        welcomeStar: "点个 Star",
        welcomeClose: "知道了",
        starLabel: "点个 star",
        starHint: "觉得有用就给个 star，插件会继续维护。",
        aboutRepo: "仓库",
        aboutVersion: "版本",
      },
      en: {
        title: "Windows desktop automation (Windows-MCP)",
        pillLabel: "Computer Use",
        pillChecking: "Computer Use — checking…",
        pillError: "Computer Use — host unreachable ({error})",
        pillOff: "Computer Use is OFF — desktop tools are hidden from the model and refused",
        pillNoTools: "Computer Use is ON — but no desktop tool is registered yet",
        pillOn: "Computer Use is ON — {count} desktop tools available",
        pillOnPlain: "Computer Use is ON",
        pillAllow: "Lets the agent operate this computer's desktop (screen capture, clicks, typing, clipboard, processes, registry) through Windows-MCP.",
        pillDeny: "When it is off these tools are hidden from the model and calls are refused.",
        pillToggle: "click to toggle",
        pillRetry: "click to retry",
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
        sectionTools: "Tool exposure",
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
        lazyLabel: "Lazy tools (saves tokens)",
        lazyHint: "Offer one entry per step; the desktop definitions only reach the model after it calls that entry. Turn off to send the whole tool table every step.",
        welcomeTitle: "Welcome to the DSH desktop automation plugin",
        welcomeLead: "The model can screenshot, click, type and manage windows once you allow it — off by default, on whenever you flip the switch.",
        welcomeDeps: "Install / update the dependency, roll back a version",
        welcomeDepsWhere: "Settings → Desktop → Dependency",
        welcomeParams: "Parameters (screenshot scale, timeout, mirrors, lazy tools)",
        welcomeParamsWhere: "Settings → Desktop",
        welcomeSwitch: "The Computer Use switch",
        welcomeSwitchWhere: "in the composer tool row; while off, no desktop tool is visible to the model",
        welcomeStar: "Star on GitHub",
        welcomeClose: "Got it",
        starLabel: "Star on GitHub",
        starHint: "If it helps, a star keeps the plugin maintained.",
        aboutRepo: "Repository",
        aboutVersion: "Version",
      },
    };

    /** The active language id: the host locale wins, the browser language is
     *  the fallback, and English is the last resort. */
    function hostLanguage() {
      try {
        if (hostLocale && typeof hostLocale.getLocale === "function") {
          var snapshot = hostLocale.getLocale();
          if (snapshot && typeof snapshot.active === "string" && snapshot.active) return snapshot.active;
        }
      } catch (error) {
        /* the optional service may be tearing down; fall back below */
      }
      try {
        var nav = null;
        if (typeof window !== "undefined" && window && window.navigator) nav = window.navigator;
        else if (typeof navigator !== "undefined") nav = navigator;
        return String((nav && nav.language) || "");
      } catch (error) {
        return "en";
      }
    }

    function copy() {
      return hostLanguage().toLowerCase().indexOf("zh") === 0 ? COPY.zh : COPY.en;
    }

    /** Read the optional client `locale` service without making it a hard
     *  dependency: an `inject` for a service nobody provides would leave this
     *  plugin's fiber pending. */
    function readLocaleService(ctx) {
      try {
        if (ctx && typeof ctx.get === "function") {
          var service = ctx.get("locale");
          if (service && typeof service.getLocale === "function") return service;
        }
      } catch (error) {
        /* absent in tests and in shells that do not ship the service */
      }
      return null;
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
          // A page that is being torn down (or a shell without timers) must not
          // leave a poller behind.
          if (typeof window === "undefined" || typeof window.setInterval !== "function") return undefined;
          var timer = window.setInterval(load, intervalMs || 2500);
          return function () {
            window.clearInterval(timer);
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

    /* ------------------------------------------------------------------ *
     * welcome dialog
     * ------------------------------------------------------------------ */

    var WELCOME_STORAGE_KEY = PACKAGE_ID + ":welcome";
    var WELCOME_EVENT = PACKAGE_ID + ":welcome";
    /* Set when an activation asked for the dialog while no host was mounted (the
       Plugins page owns no composer), so the next page that mounts one shows it. */
    var WELCOME_PENDING_KEY = PACKAGE_ID + ":welcome-pending";

    /* react-dom is optional: without a portal the dialog still renders, it just
       stays inside the slot instead of covering the window. */
    var createPortal = null;
    try {
      var reactDom = require("react-dom");
      if (reactDom !== null && reactDom !== undefined && typeof reactDom.createPortal === "function") createPortal = reactDom.createPortal;
    } catch (error) {
      createPortal = null;
    }

    /** Whether this browser already dismissed the welcome. */
    function welcomeSeen() {
      try {
        if (typeof localStorage === "undefined" || localStorage === null) return false;
        return localStorage.getItem(WELCOME_STORAGE_KEY) === "1";
      } catch (error) {
        return false;
      }
    }

    function welcomeRemember() {
      try {
        if (typeof localStorage !== "undefined" && localStorage !== null) localStorage.setItem(WELCOME_STORAGE_KEY, "1");
      } catch (error) {
        /* private mode: worst case the dialog shows again next time */
      }
    }

    /**
     * Ask the mounted host to show the dialog. Events rather than shared state so
     * the activation card and the composer pill can both ask, from anywhere.
     * @param options - `{ force }`: show it even when this browser dismissed one.
     */
    function requestWelcome(options) {
      var detail = options === null || options === undefined ? {} : options;
      if (detail.force === true) {
        try {
          if (typeof localStorage !== "undefined" && localStorage !== null) localStorage.setItem(WELCOME_PENDING_KEY, "1");
        } catch (error) {
          /* private mode: the in-mount fallback still covers a first enable */
        }
      }
      try {
        window.dispatchEvent(new CustomEvent(WELCOME_EVENT, { detail: detail }));
      } catch (error) {
        /* no window: nothing to show */
      }
    }

    function welcomeRow(label, where, key) {
      return React.createElement(
        "li",
        { key: key },
        React.createElement("b", null, label),
        React.createElement("span", null, where),
      );
    }

    /** The dialog: a modal glass sheet centred over the whole window. */
    function WelcomeDialog(props) {
      var t = copy();
      var onClose = props === null || props === undefined ? undefined : props.onClose;
      var cardRef = React.useRef(null);

      React.useEffect(function () {
        var card = cardRef.current;
        try {
          if (card !== null && card !== undefined && typeof card.focus === "function") card.focus();
        } catch (error) {
          /* focus is a nicety */
        }
        var onKeyDown = function (event) {
          if (event === null || event === undefined) return;
          if (event.key === "Escape") {
            event.preventDefault();
            if (typeof onClose === "function") onClose();
            return;
          }
          if (event.key !== "Tab" || card === null || card === undefined) return;
          var focusables = [];
          try {
            focusables = Array.prototype.slice.call(card.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"));
          } catch (error) {
            focusables = [];
          }
          if (focusables.length === 0) return;
          var first = focusables[0];
          var last = focusables[focusables.length - 1];
          var active = document.activeElement;
          if (event.shiftKey && (active === first || !card.contains(active))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        };
        try {
          document.addEventListener("keydown", onKeyDown, true);
        } catch (error) {
          return undefined;
        }
        return function () {
          try {
            document.removeEventListener("keydown", onKeyDown, true);
          } catch (error) {
            /* already gone */
          }
        };
      }, []);

      var close = function () {
        if (typeof onClose === "function") onClose();
      };

      var scrim = React.createElement(
        "div",
        {
          className: "dwmc-scrim",
          onMouseDown: function (event) {
            if (event !== null && event !== undefined && event.target === event.currentTarget) close();
          },
        },
        React.createElement(
          "div",
          {
            className: "dwmc-dialog",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": t.welcomeTitle,
            tabIndex: -1,
            ref: cardRef,
          },
          React.createElement("div", { className: "dwmc-dialog__eyebrow" }, PACKAGE_ID),
          React.createElement("h2", { className: "dwmc-dialog__title" }, t.welcomeTitle),
          React.createElement("p", { className: "dwmc-dialog__lead" }, t.welcomeLead),
          React.createElement(
            "ul",
            { className: "dwmc-dialog__list" },
            welcomeRow(t.welcomeDeps, t.welcomeDepsWhere, "deps"),
            welcomeRow(t.welcomeParams, t.welcomeParamsWhere, "params"),
            welcomeRow(t.welcomeSwitch, t.welcomeSwitchWhere, "switch"),
          ),
          React.createElement(
            "div",
            { className: "dwmc-dialog__actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "dwmc-star dwmc-star--hero",
                onClick: function () {
                  try {
                    window.open(REPO_URL, "_blank", "noopener,noreferrer");
                  } catch (error) {
                    /* a blocked popup is not worth failing the dialog over */
                  }
                },
              },
              "★ " + t.welcomeStar,
            ),
            React.createElement("button", { type: "button", className: "dwmc-btn dwmc-btn--quiet", onClick: close }, t.welcomeClose),
          ),
        ),
      );

      if (createPortal === null) return scrim;
      try {
        if (typeof document === "undefined" || document === null || !document.body) return scrim;
        return createPortal(scrim, document.body);
      } catch (error) {
        return scrim;
      }
    }

    /**
     * Owns whether the welcome is open. Mounted next to the composer pill, which
     * the shell renders on every page, so the dialog can cover the whole window.
     */
    function WelcomeHost() {
      var pair = React.useState(false);
      var open = pair[0];
      var setOpen = pair[1];

      React.useEffect(function () {
        var onRequest = function (event) {
          var detail = event !== null && event !== undefined && event.detail !== null && event.detail !== undefined ? event.detail : {};
          if (detail.force !== true && welcomeSeen()) return;
          setOpen(true);
        };
        var listening = true;
        try {
          window.addEventListener(WELCOME_EVENT, onRequest);
        } catch (error) {
          listening = false;
        }
        // An activation outside this page (the Plugins page has no composer) left
        // a note; clear it and show the dialog here instead.
        var pending = false;
        try {
          if (typeof localStorage !== "undefined" && localStorage !== null) {
            pending = localStorage.getItem(WELCOME_PENDING_KEY) === "1";
            if (pending) localStorage.removeItem(WELCOME_PENDING_KEY);
          }
        } catch (error) {
          pending = false;
        }
        // The bundle was just loaded: that is an enable in every path the Plugins
        // page does not own (a CLI install, a hand-edited profile).
        if (pending || !welcomeSeen()) setOpen(true);
        return function () {
          if (!listening) return;
          try {
            window.removeEventListener(WELCOME_EVENT, onRequest);
          } catch (error) {
            /* already gone */
          }
        };
      }, []);

      if (!open) return null;
      return React.createElement(WelcomeDialog, {
        onClose: function () {
          setOpen(false);
          welcomeRemember();
        },
      });
    }

    /** One composer cell: the pill, plus the host that floats the dialog. */
    function ComposerEntry(props) {
      return React.createElement(
        "div",
        { className: "dwmc-host" },
        React.createElement(ComputerUsePill, props),
        React.createElement(WelcomeHost, null),
      );
    }

    /** The short prompt shown after the bundle is enabled. */
    function WindowsMcpSetupPrompt(props) {
      React.useEffect(function () {
        // The Plugins page put this card here: the user just enabled the bundle,
        // so the welcome is due even if this browser saw (and closed) an earlier
        // one.
        requestWelcome({ force: true });
      }, []);
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
          lazyTools: plugin.lazyTools !== false,
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

      var toolsCard = card(t.sectionTools, [
        field(
          t.lazyLabel,
          t.lazyHint,
          React.createElement("input", {
            type: "checkbox",
            checked: draft.plugin.lazyTools !== false,
            onChange: function (event) {
              update("plugin", "lazyTools", event.target.checked);
            },
          }),
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
        toolsCard,
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
                return copy().pillLabel;
              },
              inject: function (sessionId) {
                return { sessionId: sessionId };
              },
            },
            function SlotComponent(props) {
              // The cell holds the pill and the dialog host: the composer is on
              // every page, which is what lets the welcome cover the whole window.
              return React.createElement(ComposerEntry, Object.assign({}, props, { __ctx: ctx }));
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
                    return copy().pillLabel;
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
     * The glyph of the settings entry: a monitor with a cursor cut out of its
     * screen ("this page drives the desktop"). The shell owns the nav row and
     * its default gear; `settings.section.icon` is its seat for a section's
     * own glyph, addressed by the section id.
     */
    function SettingsNavIcon(props) {
      var size = props !== null && props !== undefined && typeof props.size === "number" ? props.size : 16;
      return React.createElement(
        "svg",
        {
          xmlns: "http://www.w3.org/2000/svg",
          viewBox: "0 0 16 16",
          width: size,
          height: size,
          fill: "currentColor",
          "aria-hidden": "true",
          focusable: "false",
        },
        React.createElement("path", {
          fillRule: "evenodd",
          clipRule: "evenodd",
          d: "M2.6 2.6h10.8c.66 0 1.2.54 1.2 1.2v6.4c0 .66-.54 1.2-1.2 1.2H2.6" +
            "c-.66 0-1.2-.54-1.2-1.2V3.8c0-.66.54-1.2 1.2-1.2Zm3.1 2.5 4.5 2.85-2.1.36.98 2.06-1.16.55" +
            "-0.97-2.05-1.3 1.05z",
        }),
        React.createElement("rect", { x: 7, y: 11.2, width: 2, height: 1.7, rx: 0.3 }),
        React.createElement("rect", { x: 5.2, y: 12.9, width: 5.6, height: 1.4, rx: 0.7 }),
      );
    }

    /**
     * Register the nav glyph. The shell draws the settings rail itself and
     * falls back to its default gear unless the section id also appears in
     * `settings.section.icon`; that matching id is the only link between the
     * two slots.
     */
    function registerSettingsNavIcon(ctx) {
      try {
        ctx.slots.inject(SETTINGS_NAV_ICON_SLOT, function () {
          return ctx.slots.register(
            {
              name: SETTINGS_NAV_ICON_SLOT,
              id: SETTINGS_ENTRY_ID,
              order: SETTINGS_ORDER,
              label: function () {
                return copy().settingsNav;
              },
            },
            SettingsNavIcon,
          );
        });
      } catch (error) {
        try {
          console.error("[" + PACKAGE_ID + "] settings nav icon registration failed:", error);
        } catch (ignored) {
          /* nothing to do */
        }
      }
    }

    /**
     * Settings → left rail. `settings.section` is a list slot: one page per
     * registered entry, ordered by `order`, labelled by `label()`.
     */
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
      hostLocale = readLocaleService(ctx);
      installStyles();
      registerComposerPill(ctx);
      registerBundleSlots(ctx);
      registerSettingsNavIcon(ctx);
      registerSettingsSection(ctx);
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = {
      CSS: CSS,
      apiUrl: apiUrl,
      tooltipFor: tooltipFor,
      copy: copy,
      STATE_PATH: STATE_PATH,
      UPDATE_PATH: UPDATE_PATH,
      SETTINGS_PATH: SETTINGS_PATH,
      REPO_URL: REPO_URL,
      SETTINGS_SLOT: SETTINGS_SLOT,
      SETTINGS_NAV_ICON_SLOT: SETTINGS_NAV_ICON_SLOT,
      SettingsNavIcon: SettingsNavIcon,
      cloneSettings: cloneSettings,
      SettingsPage: SettingsPage,
      WindowsMcpPanel: WindowsMcpPanel,
      WindowsMcpBundleNote: WindowsMcpBundleNote,
      requestWelcome: requestWelcome,
      WelcomeDialog: WelcomeDialog,
      WelcomeHost: WelcomeHost,
      ComposerEntry: ComposerEntry,
      WELCOME_STORAGE_KEY: WELCOME_STORAGE_KEY,
      WELCOME_PENDING_KEY: WELCOME_PENDING_KEY,
      WELCOME_EVENT: WELCOME_EVENT,
      WELCOME_PORTAL: createPortal !== null,
    };
    return module.exports;
  },
});
