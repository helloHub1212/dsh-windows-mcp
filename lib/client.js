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
    var NPM_URL = "https://www.npmjs.com/package/dsh-windows-mcp";
    /** Simple Icons marks (CC0) at 24×24 — the same glyphs the shell's other
     *  plugin headers draw. Inlined rather than depended on: a client bundle
     *  cannot import anything that lives inside the host. */
    var BRAND_ICON_PATHS = {
      GitHub:
        "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
      npm: "M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z",
    };
    var STYLE_ID = PACKAGE_ID + "-computer-use-styles";
    /** Only `slots` is injected: it is certainly provided, and a declaration for
     *  a service nobody provides would leave this plugin's fiber pending. */
    var inject = ["slots"];
    /** The host's `locale` service, resolved in `apply()`. Optional: the plugin
     *  still renders (from the browser language) when it is absent. */
    var hostLocale = null;

    var CSS = [
      /* Borderless and unfilled in every state: the dot alone carries the state.
         Metrics, radius and hover mirror the shell's composer select
         (InputBar.module.css `.GRgSLq_select`): 28px tall, 13px/500 on a 20px
         line box, an 8px radius, and the same grey wash under the cursor —
         the shell never recolours the label on hover, so neither do we. */
      ".dwmc-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;",
      "border:none;border-radius:var(--dsw-radius-sm);background-color:transparent;",
      "color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:500;line-height:20px;",
      "cursor:pointer;white-space:nowrap;user-select:none;",
      "transition:background-color .1s ease,opacity .14s ease}",
      "@media (hover:hover){.dwmc-pill:hover:not([disabled]){background-color:var(--dsw-alias-interactive-bg-hover)}}",
      /* A half-pixel nudge on press: kept from the original pill, it reads as
         the control acknowledging the click. */
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
      ".dwmc-icon{width:14px;height:14px;flex:none;display:block}",
      "@media (max-width:860px){.dwmc-label{display:none}.dwmc-pill{padding:0 5px}}",
      "@media (prefers-reduced-motion:reduce){.dwmc-pill,.dwmc-dot{transition:none}}",
      /* Panel chrome: the plugin card, the settings dependency card and the prompt. */
      ".dwmc-dot[data-tone='on']{background:var(--dsw-alias-state-success-primary)}",
      ".dwmc-dot[data-tone='warn']{background:var(--dsw-alias-state-warn-primary)}",
      ".dwmc-dot[data-tone='off']{background:var(--dsw-alias-state-idle-primary)}",
      ".dwmc-panel{display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.55;",
      "color:var(--dsw-alias-label-primary)}",
      ".dwmc-panel__head{display:flex;align-items:center;gap:8px;font-weight:600}",
      ".dwmc-rows{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0;",
      /* Labels and values sit on one baseline even though a path value renders
         in a smaller monospace face; without this the 13px/12px mix drifts. */
      "align-items:baseline}",
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
      ".dwmc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}",
      "@media (prefers-reduced-motion:reduce){.dwmc-progress>i{animation:none}}",
      /* Settings page: plain cards, one control per row, theme tokens only. */
      ".dwmc-set{display:flex;flex-direction:column;gap:18px;max-width:720px;",
      "color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}",
      ".dwmc-set__head{display:flex;flex-direction:column;gap:6px}",
      /* Title and the two brand links share one line, the way the shell's own
         plugin headers read; the version trails them in muted grey. */
      ".dwmc-set__brand{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
      ".dwmc-set__links{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".dwmc-set__link{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;",
      "border:1px solid var(--dsw-alias-border-l1);border-radius:999px;font-size:12px;",
      "color:var(--dsw-alias-label-secondary);text-decoration:none;",
      "transition:background-color .1s ease,color .1s ease}",
      ".dwmc-set__link-icon{width:13px;height:13px;display:block;flex:none}",
      ".dwmc-set__link:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dwmc-set__version{font-size:12px;color:var(--dsw-alias-label-tertiary)}",
      ".dwmc-set__title{margin:0;font-size:16px;font-weight:600}",
      ".dwmc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;",
      "background:var(--dsw-alias-bg-layer-1);padding:14px 16px;display:flex;flex-direction:column;gap:12px}",
      ".dwmc-card__title{margin:0;font-size:13px;font-weight:600}",
      ".dwmc-field{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}",
      /* `flex:1 1 0` rather than the default `auto`: with `auto` the label block's
         hypothetical width is the whole hint on one line, which overflows the row
         and pushes the control onto a line of its own. Growing from zero lets the
         hint wrap inside the block and keeps the control on the same row. */
      ".dwmc-field__label{display:flex;flex-direction:column;gap:2px;flex:1 1 0;min-width:180px}",
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
      /* The page auto-saves, so nothing floats: the one destructive action stays
         at the end of the form like a normal footer, and this note row exists
         only when the save produced something the person has to act on. */
      ".dwmc-set__status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0}",
      ".dwmc-set__footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;",
      "margin-top:6px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}",
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
        // Rewrite rather than bail out when the element is already there: a
        // bundle re-evaluated without a full page load keeps the previous
        // `<style>` node, and an early return would leave the new markup
        // wearing the old rules (a footer div with no footer rule renders its
        // button at the left edge, which looks like a layout bug in the JS).
        var element = document.getElementById(STYLE_ID);
        if (element === null) {
          element = document.createElement("style");
          element.id = STYLE_ID;
          document.head.appendChild(element);
        }
        if (element.textContent !== CSS) element.textContent = CSS;
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

    /** Tooltip copy: the state, then what turning the switch off would cost.
     *  No capability list: any enumeration here is a second, hand-maintained
     *  copy of the bridge's tool table, and it silently understated the grant
     *  (six of eighteen tools) the moment upstream grew. The consequences are
     *  the part the reader cannot infer; the capability surface is documented
     *  in Settings → Desktop control and the welcome dialog.
     *
     *  The consequence line is conditional: it only appears when the switch is
     *  confirmed on and there is something to lose.
     *
     *  There is no "click to toggle" line: the control already is a switch
     *  (role, cursor, state dot), so telling the reader to click it is the one
     *  thing they worked out before hovering. The retry line stays, because
     *  the same click does something different once the host is unreachable. */
    function tooltipFor(view) {
      var t = copy();
      var head;
      if (view.phase === "loading") head = t.pillChecking;
      else if (view.phase === "error") head = fill(t.pillError, { error: view.error });
      else if (!view.enabled) head = t.pillOff;
      else if (view.bridged === 0) head = t.pillNoTools;
      else if (typeof view.bridged === "number") head = fill(t.pillOn, { count: view.bridged });
      else head = t.pillOnPlain;
      var lines = [head];
      // Only a confirmed `true` counts as on, and a switch with nothing behind
      // it has nothing to lose: neither case earns the consequence line.
      if (view.enabled === true && view.bridged !== 0) lines.push(t.pillDeny);
      if (view.phase === "error") lines.push(t.pillRetry);
      return lines.join("\n");
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
        pillChecking: "正在确认控制权…",
        pillError: "无法连接宿主（{error}）",
        pillOff: "AI 未获得控制权 · 桌面工具对模型不可见，调用会被拒绝",
        pillNoTools: "AI 已获得控制权 · 尚无桌面工具注册，请检查依赖",
        pillOn: "AI 正在控制这台电脑 · {count} 个桌面工具已注册",
        pillOnPlain: "AI 正在控制这台电脑",
        pillDeny: "关闭后，这些工具会对模型不可见，调用会被拒绝。",
        pillRetry: "请点击重试",
        dependency: "依赖",
        installed: "已安装",
        missing: "未安装",
        uvMissing: "未找到 uv",
        tool: "可执行文件",
        bridge: "桥",
        bridgedTools: "个工具已注册",
        profile: "写入目标",
        profileAmbiguous: "检测到多个已装本插件的 profile，写入前请在本机设置 DSH_WINDOWS_MCP_PROFILE",
        install: "下载并安装",
        reinstall: "重新下载",
        cancel: "取消",
        pointBridge: "让桥指向它",
        estimate: "首次约 60 MB，一次即可；安装完成后会自动把桥指向它，重启 DSH 生效。",
        running: "正在下载并安装…",
        ok: "安装完成",
        failed: "安装失败",
        cancelled: "已取消",
        ready: "依赖已就绪，桌面工具可用（记得把「AI 控制电脑」开关打开）。",
        readyOn: "依赖已就绪，桌面工具可用。",
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
        settingsRestart: "桥接参数已写入配置，重启 DSH 后生效。",
        settingsWriteFailed: "自动保存失败，改动没有写入：",
        settingsDefaults: "恢复默认值",
        settingsDefaultsConfirm: "恢复默认值？所有设置都会重置为默认值。",
        settingsConfirm: "确认恢复",
        settingsIgnored: "部分取值无效，已回退为默认值：",
        bundleHint: "安装、更新和回退都在 设置 → 桌面控制 里管理。",
        sectionDependency: "依赖（Windows-MCP）",
        sectionBridge: "桥接（重启 DSH 生效）",
        sectionUpdates: "更新与镜像",
        sectionTools: "工具暴露",
        timeoutLabel: "工具调用超时",
        timeoutHint: "毫秒，5000–600000。越长越不容易被中断，卡住时也等得越久。",
        scaleLabel: "截图缩放",
        scaleHint: "越小越省视觉 token，细节也越少。",
        backendLabel: "截图后端",
        backendHint: "auto 交给上游挑；dxcam 最快，pillow 最慢但最稳。",
        flashLabel: "截图闪光边框",
        flashHint: "勾选后每次截图会在屏幕边框闪一下，方便看清截的是哪块；不勾选可少一次桌面重绘。默认不勾选。",
        excludeLabel: "屏蔽的工具",
        excludeHint: "勾选后，这些工具不会出现在模型的工具表里，能省上下文。",
        autoCheckLabel: "启动时检查更新",
        autoCheckHint: "勾选后每次启动都在后台查一次最新版，结果缓存 6 小时。",
        mirrorLabel: "首选镜像",
        mirrorHint: "auto 用测速最快的镜像；固定某个可避开波动。",
        lazyLabel: "惰性工具（省 token）",
        lazyHint: "勾选后只给模型一个入口，调用它之后才把桌面工具的完整定义发过去；不勾选则每一步都带上全部工具表。",
        welcomeTitle: "欢迎使用 DSH 桌面控制插件",
        welcomeLead: "打开后，模型可以操作这台电脑：截屏、鼠标键盘、剪贴板、进程和注册表等 —— 默认关闭，随时可在输入框工具行切换。",
        welcomeDeps: "依赖安装 / 更新、版本回退",
        welcomeDepsWhere: "设置 → 桌面控制 → 「依赖」",
        welcomeParams: "参数调整（截图缩放、超时、镜像、惰性工具）",
        welcomeParamsWhere: "设置 → 桌面控制",
        welcomeSwitch: "「AI 控制电脑」开关",
        welcomeSwitchWhere: "输入框工具行；关闭时所有桌面工具对模型不可见",
        welcomeStar: "点个 Star",
        welcomeClose: "知道了",
      },
      en: {
        title: "Windows desktop automation (Windows-MCP)",
        pillLabel: "Computer Use",
        pillChecking: "Computer Use — checking…",
        pillError: "Computer Use — host unreachable ({error})",
        pillOff: "Computer Use is OFF — desktop tools are hidden from the model and refused",
        pillNoTools: "Computer Use is ON — but no desktop tool is registered yet",
        pillOn: "Computer Use is ON — {count} desktop tools registered",
        pillOnPlain: "Computer Use is ON",
        pillDeny: "Turning it off hides these tools from the model and refuses further calls.",
        pillRetry: "Click to retry",
        dependency: "Dependency",
        installed: "installed",
        missing: "not installed",
        uvMissing: "uv not found",
        tool: "Executable",
        bridge: "Bridge",
        bridgedTools: "tools registered",
        profile: "Patch target",
        profileAmbiguous: "this package is installed in several profiles — set DSH_WINDOWS_MCP_PROFILE on this host",
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
        readyOn: "Dependency ready — the desktop tools are available.",
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
        settingsRestart: "Bridge values were written to the patch layer — restart DSH to apply them.",
        settingsWriteFailed: "Auto-save failed — the change was not written:",
        settingsDefaults: "Restore defaults",
        settingsDefaultsConfirm: "Restore defaults? Every setting returns to its default value.",
        settingsConfirm: "Restore",
        settingsIgnored: "Some values were invalid and fell back to the defaults:",
        bundleHint: "Install, update and roll back in Settings → Desktop.",
        sectionDependency: "Dependency (Windows-MCP)",
        sectionBridge: "Bridge (applies after a DSH restart)",
        sectionUpdates: "Updates and mirrors",
        sectionTools: "Tool exposure",
        timeoutLabel: "Tool call timeout",
        timeoutHint: "Milliseconds, 5000–600000. Longer waits are interrupted less often, and stall longer when something hangs.",
        scaleLabel: "Screenshot scale",
        scaleHint: "Smaller costs fewer vision tokens and shows less detail.",
        backendLabel: "Screenshot backend",
        backendHint: "auto lets the server choose; dxcam is fastest, pillow slowest but most compatible.",
        flashLabel: "Screenshot flash border",
        flashHint: "When checked, a border flashes around the screen on each capture so you can see what was grabbed; unchecked skips one repaint. Unchecked by default.",
        excludeLabel: "Hidden tools",
        excludeHint: "Checked tools stay out of the model's tool table, which saves context.",
        autoCheckLabel: "Check for updates at boot",
        autoCheckHint: "When checked, one background check per boot, cached for six hours.",
        mirrorLabel: "Preferred mirror",
        mirrorHint: "auto uses the fastest probe; pinning one avoids jitter.",
        lazyLabel: "Lazy tools (saves tokens)",
        lazyHint: "When checked, the model gets one entry per step and the desktop definitions only arrive after it calls that entry; unchecked sends the whole tool table every step.",
        welcomeTitle: "Welcome to the DSH desktop automation plugin",
        welcomeLead: "Turn it on and the model can operate this computer: screenshots, mouse and keyboard, clipboard, processes and the registry, and more — off by default, on whenever you flip the switch.",
        welcomeDeps: "Install / update the dependency, roll back a version",
        welcomeDepsWhere: "Settings → Desktop → Dependency",
        welcomeParams: "Parameters (screenshot scale, timeout, mirrors, lazy tools)",
        welcomeParamsWhere: "Settings → Desktop",
        welcomeSwitch: "The Computer Use switch",
        welcomeSwitchWhere: "in the composer tool row; while off, no desktop tool is visible to the model",
        welcomeStar: "Star on GitHub",
        welcomeClose: "Got it",
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
      // The dependency is ready either way; only the hint about the composer
      // switch depends on that switch, so the copy has to follow it. The panel
      // itself shows no switch state: the pill always does, one hover away.
      var readyNote = state.enabled === true ? t.readyOn : t.ready;
      if (!compact) {
        var rows = [
          [t.dependency, installed ? t.installed + (dependency.version ? " " + dependency.version : "") : dependency.uv === null ? t.uvMissing : t.missing],
          [t.version, versions.active ? "v" + versions.active : dependency.version ? "v" + dependency.version : "—"],
          [
            t.latest,
            typeof check.latest === "string"
              // "up to date" only means something once something is installed:
              // with no dependency the row is a version, not a verdict.
              ? "v" + check.latest + (installed ? " · " + (updateAvailable ? t.updateAvailable : t.upToDate) : "")
              : t.notChecked,
          ],
        ];
        if (typeof versions.previous === "string") rows.push([t.previous, "v" + versions.previous]);
        if (Array.isArray(versions.available) && versions.available.length > 0) {
          rows.push([t.kept, versions.available.map(function (version) { return "v" + version; }).join(", ")]);
        }
        if (bestMirror !== null) rows.push([t.mirror, bestMirror.label + " · " + speedText(bestMirror.speedBps)]);
        rows.push([t.tool, dependency.executable || "—", true]);
        rows.push([t.bridge, bridged === null ? "—" : bridged + " " + t.bridgedTools]);
        rows.push([t.profile, profileTarget, true]);
        children.push(
          React.createElement(
            "dl",
            { className: "dwmc-rows", key: "rows" },
            rows.map(function (row, index) {
              return [
                React.createElement("dt", { key: "dt" + index }, row[0]),
                React.createElement(
                  "dd",
                  // Only paths are monospaced: a mono block for every value made
                  // the column read as a different, smaller typeface than the
                  // labels it sat next to.
                  { key: "dd" + index, className: row[2] === true ? "dwmc-mono" : undefined },
                  String(row[1]),
                ),
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
        children.push(React.createElement("p", { className: "dwmc-note", key: "ok" }, installed ? readyNote : t.ok));
        if (prepare.bridge && prepare.bridge.ok === true && prepare.bridge.restartRequired === true) {
          children.push(React.createElement("p", { className: "dwmc-note", key: "restart" }, t.restart));
        }
      } else if (installed && !compact) {
        children.push(React.createElement("p", { className: "dwmc-note", key: "ready" }, readyNote));
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
            // `ok: false` means the values were stored but the bridge row was
            // not rewritten; that reason lives one level down and is the only
            // thing the page can say about the failed save.
            var writeError =
              body && body.ok === false
                ? String((body.write && body.write.error) || body.error || "the bridge row was not written")
                : null;
            setSaved({ phase: body && body.ok === false ? "error" : "saved", body: body, error: writeError });
            return body;
          })
          .catch(function (error) {
            setSaved({ phase: "error", body: null, error: String(error && error.message ? error.message : error) });
            return null;
          });
      }, []);

      return { view: view, saved: saved, save: save, reload: load };
    }

    /** Settings → left rail: the plugin's parameter page. */
    function SettingsPage() {
      var t = copy();
      var host = useSettings();
      var view = host.view;
      var draftPair = React.useState(null);
      var draft = draftPair[0];
      var setDraft = draftPair[1];
      // The latest draft, for callbacks that outlive the render that made them.
      var draftRef = React.useRef(null);
      draftRef.current = draft;
      // Which destructive button is asking for a second click: null, "defaults".
      var confirmPair = React.useState(null);
      var confirm = confirmPair[0];
      var setConfirm = confirmPair[1];

      var ready = view.phase === "ready" && view.view && view.view.settings ? view.view : null;

      React.useEffect(
        function () {
          if (ready === null) return;
          // A background refresh must not overwrite a draft the person is still
          // editing; their own save picks the server's version up right after.
          if (
            draftRef.current !== null &&
            JSON.stringify(draftRef.current) !== JSON.stringify(cloneSettings(ready.settings))
          ) {
            return;
          }
          setDraft(cloneSettings(ready.settings));
        },
        [ready === null ? null : JSON.stringify(ready.settings)],
      );

      // The draft lives only in this component. A save that has not landed yet
      // (or one that failed) is still worth a confirmation on close.
      var dirtyNow =
        draft !== null && ready !== null && JSON.stringify(draft) !== JSON.stringify(cloneSettings(ready.settings));
      React.useEffect(
        function () {
          if (!dirtyNow) return undefined;
          var guard = function (event) {
            event.preventDefault();
            event.returnValue = "";
          };
          window.addEventListener("beforeunload", guard);
          return function () {
            window.removeEventListener("beforeunload", guard);
          };
        },
        [dirtyNow],
      );

      // Auto-save: a beat after the last change, push the draft to the host.
      // The timer re-arms on `draftKey`, not on `dirtyNow` — the latter stays
      // true across a burst of edits and would fire only once.
      var draftKey = draft === null ? "" : JSON.stringify(draft);
      var saveRef = React.useRef(null);
      saveRef.current = function (payload) {
        return host.save(payload);
      };
      React.useEffect(
        function () {
          if (draft === null || ready === null || !dirtyNow) return undefined;
          var payload = draft;
          var sent = JSON.stringify(payload);
          var timer = setTimeout(function () {
            saveRef.current(payload).then(function (body) {
              // Someone kept typing while the request was in flight: keeping
              // their newer draft beats dropping their keystrokes.
              if (body && body.settings && JSON.stringify(draftRef.current) === sent) {
                setDraft(cloneSettings(body.settings));
              }
            });
          }, 700);
          return function () {
            clearTimeout(timer);
          };
        },
        [draftKey, dirtyNow],
      );

      if (view.phase === "loading") return React.createElement("p", { className: "dwmc-note" }, t.checking);
      if (view.phase === "error") return React.createElement("p", { className: "dwmc-error" }, t.hostDown + " — " + String(view.error || ""));
      if (draft === null || ready === null) return React.createElement("p", { className: "dwmc-note" }, t.checking);

      var dirty = dirtyNow;
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
      // A brand link in the header: a bordered pill, the shape the shell's own
      // plugin headers use. The label is a product name, so it is not localised.
      var brandLink = function (label, href) {
        var path = BRAND_ICON_PATHS[label];
        return React.createElement(
          "a",
          { className: "dwmc-set__link", href: href, target: "_blank", rel: "noopener noreferrer", key: label },
          path === undefined
            ? null
            : React.createElement(
                "svg",
                { className: "dwmc-set__link-icon", viewBox: "0 0 24 24", "aria-hidden": "true" },
                React.createElement("path", { fill: "currentColor", d: path }),
              ),
          label,
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
            // `disableFlash` is the stored negative, but the label is the
            // positive: a ticked box has to mean "show the border", otherwise
            // every reader has to invert it in their head.
            checked: draft.bridge.disableFlash !== true,
            onChange: function (event) {
              update("bridge", "disableFlash", event.target.checked !== true);
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

      // Auto-save puts the status at the top, where the edit happens: the one
      // button left at the bottom is the destructive one. The failure text is
      // the status itself now, so it is not repeated in the notes.
      var notes = [];
      if (host.saved.phase === "error") {
        // Auto-save is silent by design; a failure must not be.
        notes.push(
          React.createElement(
            "span",
            { key: "failed", className: "dwmc-error" },
            t.settingsWriteFailed + " " + String(host.saved.error || ""),
          ),
        );
      }
      if (ready.restartRequired && host.saved.phase !== "saving") {
        notes.push(React.createElement("span", { key: "restart", className: "dwmc-warn" }, t.settingsRestart));
      }
      if (host.saved.body && Array.isArray(host.saved.body.problems) && host.saved.body.problems.length > 0) {
        notes.push(React.createElement("span", { key: "ignored", className: "dwmc-warn" }, t.settingsIgnored + " " + host.saved.body.problems.join(", ")));
      }

      // The page saves itself, so the only action left is the destructive one —
      // and it sits at the end of the form, in flow, where a footer belongs.
      var footer = React.createElement(
        "div",
        { className: "dwmc-set__footer" },
        confirm === "defaults"
          ? [
              React.createElement("span", { key: "ask", className: "dwmc-warn" }, t.settingsDefaultsConfirm),
              React.createElement(
                "button",
                {
                  key: "yes",
                  type: "button",
                  className: "dwmc-btn",
                  onClick: function () {
                    setDraft(cloneSettings(ready.defaults || ready.settings));
                    setConfirm(null);
                  },
                },
                t.settingsConfirm,
              ),
              React.createElement(
                "button",
                { key: "no", type: "button", className: "dwmc-btn dwmc-btn--quiet", onClick: function () { setConfirm(null); } },
                t.cancel,
              ),
            ]
          : [
              React.createElement(
                "button",
                {
                  key: "defaults",
                  type: "button",
                  className: "dwmc-btn dwmc-btn--quiet",
                  onClick: function () { setConfirm("defaults"); },
                  disabled: saving || !ready.defaults,
                },
                t.settingsDefaults,
              ),
            ],
      );

      return React.createElement(
        "div",
        { className: "dwmc-set" },
        React.createElement(
          "div",
          { className: "dwmc-set__head" },
          React.createElement(
            "div",
            { className: "dwmc-set__brand" },
            React.createElement("h2", { className: "dwmc-set__title" }, t.settingsTitle),
            React.createElement(
              "div",
              { className: "dwmc-set__links" },
              brandLink("GitHub", REPO_URL),
              brandLink("npm", NPM_URL),
              React.createElement("span", { className: "dwmc-set__version" }, "v" + String(ready.pluginVersion || "?")),
            ),
          ),
          notes.length === 0
            ? null
            : React.createElement("p", { className: "dwmc-set__status" }, notes),
        ),
        dependencyCard,
        bridgeCard,
        updatesCard,
        toolsCard,
        footer,
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
      NPM_URL: NPM_URL,
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
