(() => {
  "use strict";

  // Only run where Roblox actually has trading UI.
  const TRADE_PATH = /^\/(trades|users\/\d+\/trade)(?:\/|$)/i;
  const IS_TRADE_PAGE = TRADE_PATH.test(location.pathname);
  // Profile and inventory pages (/users/<id>/profile, /users/<id>/inventory) only get values if the user opts in.
  const PROFILE_PATH = /^\/users\/\d+\/(?:profile|inventory)(?:\/|$)/i;
  const IS_PROFILE_PAGE = PROFILE_PATH.test(location.pathname);
  let profileValuesEnabled = false;   // setting: profileValuesEnabled (off by default)
  let graphEnabled = false;           // setting: graphButtonEnabled (off by default)
  // Checked live because Roblox navigates without reloading the page.
  function pageAllowed() {
    return TRADE_PATH.test(location.pathname) || (profileValuesEnabled && PROFILE_PATH.test(location.pathname));
  }
  function clearValues() {
    if (pageAllowed()) return;
    document.querySelectorAll(".roli-value-footer").forEach(el => el.remove());
  }

  const VALUE_CLASS = "rolimons-inline-value";
  const TOTAL_CLASS = "rolimons-total-value";
  const POPUP_ID = "rolimons-item-popup";
  const STATUS_ID = "rolimons-status";

  let itemData = null;
  let renderTimer = null;
  let rendering = false;
  const tradeInfoCache = new Map();
  const routilityCache = new Map();
  const ROUTILITY_CACHE_TTL = 5 * 60 * 1000;
  let routilityEnabled = false;
  let routilityStatsEnabled = false; // setting: routilityStatsEnabled (Stats popup)
  const routilityStatsCache = new Map();
  const ROUTILITY_DEFAULTS = {
    label: "USD",
    text: "#8f98a5",
    background: "#8f98a5",
    border: "#8f98a5",
    showLabel: true,
    decimals: 2,
    currency: "$"
  };
  let routilityCfg = { ...ROUTILITY_DEFAULTS };

  function formatRoutility(v) {
    const d = Math.min(2, Math.max(0, Number(routilityCfg.decimals) || 0));
    const sym = routilityCfg.currency === "none" ? "" : (routilityCfg.currency || "$");
    return sym + Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  let authenticatedUserId = null;
  let winLossEnabled = true;   // setting: tradeWinLossEnabled (on by default)

  const DEFAULT_COLORS = {
    valueText: "#00a2ff",
    valueBackground: "rgba(0, 162, 255, 0.08)",
    valueBorder: "rgba(0, 162, 255, 0.24)",
    totalText: "#00a2ff",
    totalBackground: "rgba(0, 162, 255, 0.09)",
    totalBorder: "rgba(0, 162, 255, 0.26)"
  };
  let colors = { ...DEFAULT_COLORS };

  const fmt = (n) => Number(n || 0).toLocaleString();

  function colorWithAlpha(color, alpha) {
    if (typeof color !== "string") return color;
    const m = color.trim().match(/^#([0-9a-f]{6})$/i);
    if (!m) return color;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applyColorVariables() {
    const root = document.documentElement;
    root.style.setProperty("--roli-value-text", colors.valueText);
    root.style.setProperty("--roli-value-bg", colorWithAlpha(colors.valueBackground, 0.08));
    root.style.setProperty("--roli-value-border", colors.valueBorder);
    root.style.setProperty("--roli-total-text", colors.totalText);
    root.style.setProperty("--roli-total-bg", colorWithAlpha(colors.totalBackground, 0.09));
    root.style.setProperty("--roli-total-border", colors.totalBorder);
    root.style.setProperty("--roli-usd-text", routilityCfg.text);
    root.style.setProperty("--roli-usd-bg", colorWithAlpha(routilityCfg.background, 0.08));
    root.style.setProperty("--roli-usd-border", colorWithAlpha(routilityCfg.border, 0.35));
    root.style.setProperty("--roli-usd-label-display", routilityCfg.showLabel ? "block" : "none");
  }

  function applyRoutilityLabels() {
    document.querySelectorAll(".roli-routility-label").forEach(el => {
      el.textContent = routilityCfg.label || "USD";
    });
  }

  async function loadColors() {
    try {
      const stored = await browser.storage.local.get(["rolimonsColors", "routilitySettings"]);
      if (stored.rolimonsColors && typeof stored.rolimonsColors === "object") {
        colors = { ...DEFAULT_COLORS, ...stored.rolimonsColors };
      }
      routilityCfg = { ...ROUTILITY_DEFAULTS, ...(stored.routilitySettings || {}) };
    } catch (e) {
      console.warn("[Rolimon's] color settings read failed", e);
    }
    applyColorVariables();
  }

  function ensureStyle() {
    if (document.getElementById("rolimons-style")) {
      applyColorVariables();
      return;
    }
    const style = document.createElement("style");
    style.id = "rolimons-style";
    style.textContent = `
      /* ---- Value pill (one per item) ---- */
      .${VALUE_CLASS} {
        display: flex !important;
        flex-direction: column !important;
        gap: 3px !important;
        box-sizing: border-box !important;
        width: 100% !important;
        min-width: 0 !important;
        height: auto !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 5px 8px !important;
        flex: 0 0 auto !important;
        border: 1px solid var(--roli-value-border) !important;
        background-color: var(--roli-value-bg) !important;
        border-radius: 6px !important;
        color: inherit !important;
        font-family: Arial, Helvetica, sans-serif !important;
        line-height: 1 !important;
        text-align: left !important;
        overflow: hidden !important;
        position: relative !important;
        cursor: default !important;
      }
      /* ---- Stats button (opens the item stats popup) ---- */
      .roli-stats-btn {
        flex: 0 0 auto !important;
        box-sizing: border-box !important;
        align-self: stretch !important;
        margin: 0 !important;
        padding: 3px 8px !important;
        border: 1px solid var(--roli-value-border) !important;
        border-radius: 6px !important;
        background: var(--roli-value-bg) !important;
        color: var(--roli-value-text) !important;
        font: 700 10px/12px Arial, Helvetica, sans-serif !important;
        letter-spacing: .4px !important;
        text-transform: uppercase !important;
        white-space: nowrap !important;
        cursor: pointer !important;
        transition: filter .12s ease !important;
      }
      .roli-stats-btn:hover { filter: brightness(1.15) !important; }
      .roli-stats-btn:focus-visible { outline: 2px solid var(--roli-value-text) !important; outline-offset: 1px !important; }
      /* On thumbnails the value + USD stay on one row; Stats sits on its own full-width row below. */
      .roli-footer-overlay .roli-stats-btn { flex: 1 1 100% !important; width: 100% !important; padding: 2px 6px !important; background: rgba(18,20,24,.82) !important; color: #fff !important; border-color: rgba(255,255,255,.18) !important; }
      /* Stats + Graph share one row (Graph only exists when enabled in settings). */
      .roli-btn-row { display: flex !important; gap: 3px !important; flex: 1 1 100% !important; width: 100% !important; min-width: 0 !important; box-sizing: border-box !important; }
      .roli-btn-row .roli-stats-btn { flex: 1 1 0 !important; width: auto !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; }
      .${VALUE_CLASS} .roli-main {
        display: flex !important;
        align-items: baseline !important;
        justify-content: space-between !important;
        gap: 6px !important;
        width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .${VALUE_CLASS} .roli-label {
        flex: 0 0 auto !important;
        margin: 0 !important;
        padding: 0 !important;
        opacity: .65 !important;
        font-size: 9px !important;
        line-height: 12px !important;
        font-weight: 700 !important;
        letter-spacing: .6px !important;
        text-transform: uppercase !important;
        white-space: nowrap !important;
      }
      .${VALUE_CLASS} .roli-number {
        flex: 0 1 auto !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        color: var(--roli-value-text) !important;
        font-size: 13px !important;
        line-height: 14px !important;
        font-weight: 800 !important;
        font-variant-numeric: tabular-nums !important;
        white-space: nowrap !important;
        text-align: right !important;
      }
      .${VALUE_CLASS} .roli-sub {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 6px !important;
        width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 3px 0 0 !important;
        border-top: 1px solid var(--roli-value-border) !important;
        opacity: .72 !important;
        font-size: 10px !important;
        line-height: 12px !important;
        font-weight: 600 !important;
        white-space: nowrap !important;
      }
      .${VALUE_CLASS} .roli-sub span { overflow: hidden !important; text-overflow: ellipsis !important; min-width: 0 !important; }

      /* ---- Footer that holds the value pill (+ optional RoUtility row) ---- */
      .roli-value-footer {
        display: flex !important;
        flex-direction: column !important;
        gap: 3px !important;
        flex: 0 0 auto !important;
        box-sizing: border-box !important;
        width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 4px 2px 0 !important;
        position: relative !important;
        z-index: 1 !important;
        clear: both !important;
        overflow: visible !important;
      }

      /* ---- Inventory: wrapper is the real grid item. Card and footer are
         separate normal-flow children, so nothing can paint over the next row. ---- */
      .roli-inventory-item-wrap {
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        box-sizing: border-box !important;
        width: 100% !important;
        min-width: 0 !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 0 8px !important;
        padding: 0 !important;
        overflow: visible !important;
        position: relative !important;
      }
      .roli-inventory-item-wrap > :first-child { margin-bottom: 0 !important; }

      /* ---- Offer cards: let Roblox's fixed-height card grow to fit the footer ---- */
      .roli-footer-overlay {
        position: absolute !important;
        left: 3px !important;
        right: 3px !important;
        bottom: 3px !important;
        width: auto !important;
        padding: 0 !important;
        gap: 2px !important;
        z-index: 5 !important;
        margin: 0 !important;
        height: auto !important;
        min-height: 0 !important;
        pointer-events: auto !important;
      }
      .roli-footer-inline {
        display: flex !important;
        flex-direction: row !important;
        flex-wrap: wrap !important;
        align-items: center !important;
        gap: 4px !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 3px 0 0 !important;
        padding: 0 !important;
        position: relative !important;
      }
      .roli-footer-inline .${VALUE_CLASS} {
        flex-direction: row !important;
        width: auto !important;
        padding: 2px 6px !important;
      }
      .roli-footer-inline .${VALUE_CLASS} .roli-main { gap: 5px !important; }
      .roli-footer-inline .${VALUE_CLASS} .roli-number { font-size: 12px !important; }
      .roli-footer-inline .roli-routility-value {
        width: auto !important;
        padding: 2px 6px !important;
        grid-template-columns: max-content max-content !important;
        column-gap: 5px !important;
        font-size: 11px !important;
      }
      /* Offer rows: strictly one compact line, shrink-to-fit pills */
      .roli-footer-inline { flex-wrap: wrap !important; justify-content: flex-start !important; container-type: inline-size !important; box-sizing: border-box !important; min-width: 0 !important; }
      .roli-footer-inline .${VALUE_CLASS} { flex: 0 1 auto !important; min-width: 0 !important; }
      .roli-footer-inline .${VALUE_CLASS} .roli-main { width: auto !important; }
      .roli-footer-inline .roli-routility-value { flex: 0 1 auto !important; }
      .roli-footer-inline .roli-routility-label { display: none !important; }
      /* Narrow cards (trade detail grid): each pill gets its own full-width line */
      @container (max-width: 200px) {
        .roli-footer-inline .${VALUE_CLASS},
        .roli-footer-inline .roli-routility-value { flex: 1 1 100% !important; width: 100% !important; max-width: 100% !important; }
        .roli-footer-inline .${VALUE_CLASS} .roli-main { width: 100% !important; justify-content: space-between !important; }
        .roli-footer-inline .roli-routility-value { grid-template-columns: minmax(0, 1fr) max-content !important; }
        .roli-footer-inline .roli-routility-label { display: block !important; }
      }

      /* Serial / unique chip lifted to the top-left of inventory thumbnails */
      .roli-serial {
        position: absolute !important;
        top: 6px !important;
        left: 6px !important;
        bottom: auto !important;
        right: auto !important;
        transform: none !important;
        z-index: 6 !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 4px !important;
        width: auto !important;
        height: auto !important;
        min-width: 0 !important;
        padding: 2px 7px 2px 4px !important;
        border-radius: 7px !important;
        background: rgba(10, 12, 16, .88) !important;
        color: #fff !important;
        font: 800 13px/18px Arial, Helvetica, sans-serif !important;
        letter-spacing: .2px !important;
        text-shadow: none !important;
        white-space: nowrap !important;
        box-shadow: 0 1px 4px rgba(0,0,0,.45) !important;
      }
            .roli-serial { max-width: calc(100% - 44px) !important; overflow: hidden !important; box-sizing: border-box !important; }
      .roli-serial * {
        position: static !important;
        transform: none !important;
        margin: 0 !important;
        inset: auto !important;
        color: #fff !important;
        font-size: 13px !important;
        font-weight: 800 !important;
        line-height: 18px !important;
        opacity: 1 !important;
        flex: 0 0 auto !important;
        white-space: nowrap !important;
      }
      .roli-serial svg, .roli-serial img { width: 16px !important; height: 16px !important; }

      /* Roblox's own "Limited" / "Limited U" tag, moved to the top-left so it never sits under the value row */
      .roli-limited-tag {
        position: absolute !important;
        top: 6px !important;
        left: 6px !important;
        bottom: auto !important;
        right: auto !important;
        transform: none !important;
        margin: 0 !important;
        z-index: 6 !important;
      }
      .roli-limited-tag.roli-limited-low { top: 30px !important; }
      .roli-pl-before::before, .roli-pl-after::after {
        position: absolute !important;
        top: 6px !important;
        left: 6px !important;
        bottom: auto !important;
        right: auto !important;
        transform: none !important;
        z-index: 6 !important;
      }

      /* Inventory badges: ONE slim row (value + USD side by side) */
      .roli-footer-overlay { flex-direction: row !important; align-items: stretch !important; flex-wrap: wrap !important; }
      .roli-footer-overlay .${VALUE_CLASS} { flex: 1 1 0 !important; width: auto !important; flex-direction: row !important; min-width: 0 !important; padding: 3px 5px !important; }
      .roli-footer-overlay .roli-routility-value { flex: 0 0 auto !important; width: auto !important; grid-template-columns: max-content !important; padding: 3px 5px !important; border: 1px solid rgba(255,255,255,.18) !important; }
      .roli-footer-overlay .roli-routility-label { display: none !important; }
      .roli-footer-overlay.roli-has-usd .roli-label { display: none !important; }
      .roli-footer-overlay.roli-has-usd .roli-main { justify-content: center !important; }
      .roli-footer-overlay { max-height: 64px !important; overflow: hidden !important; }
      .roli-footer-overlay.roli-top { top: 3px !important; bottom: auto !important; max-height: 64px !important; }
      .roli-footer-overlay.roli-top .roli-routility-value { padding: 1px 5px !important; font-size: 9px !important; line-height: 11px !important; }
      .roli-footer-overlay .roli-routility-value {
        padding: 2px 6px !important;
        border: 0 !important;
        border-radius: 5px !important;
        color: #cfd6df !important;
        font-size: 10px !important;
        line-height: 12px !important;
      }
      .roli-footer-overlay .roli-routility-label { font-size: 8px !important; }
      .roli-footer-overlay.roli-compact .roli-routility-label { display: none !important; }
      .roli-footer-overlay.roli-compact .roli-routility-value { grid-template-columns: 1fr !important; text-align: center !important; }
      .roli-footer-overlay.roli-compact .roli-label { display: none !important; }
      .roli-footer-overlay.roli-compact .roli-main { justify-content: center !important; }
      .roli-footer-overlay .${VALUE_CLASS} {
        padding: 3px 6px !important;
        background-color: rgba(18, 20, 24, .82) !important;
        color: #fff !important;
        backdrop-filter: blur(2px) !important;
      }
      .roli-footer-overlay .roli-routility-value { background: rgba(18,20,24,.82) !important; padding: 2px 6px !important; }
      .roli-grown {
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
      }
      .roli-grown > .roli-value-footer { padding-bottom: 4px !important; }

      .roli-routility-value {
        box-sizing: border-box !important;
        width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 4px 8px !important;
        border: 1px solid var(--roli-usd-border, rgba(143,152,165,.35)) !important;
        background-color: var(--roli-usd-bg, transparent) !important;
        border-radius: 6px !important;
        color: var(--roli-usd-text, #8f98a5) !important;
        font: 700 10px/13px Arial, Helvetica, sans-serif !important;
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) max-content !important;
        align-items: center !important;
        column-gap: 6px !important;
        text-align: left !important;
        flex: 0 0 auto !important;
        overflow: hidden !important;
      }
      .roli-routility-value .roli-routility-label {
        display: var(--roli-usd-label-display, block) !important;
        min-width: 0 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        text-transform: uppercase !important;
        letter-spacing: .4px !important;
        font-size: 9px !important;
      }
      .roli-routility-value .roli-routility-number {
        white-space: nowrap !important;
        font-weight: 800 !important;
        font-size: 11px !important;
      }

      .${TOTAL_CLASS} {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 12px !important;
        box-sizing: border-box !important;
        width: 100% !important;
        min-width: 0 !important;
        min-height: 42px !important;
        margin: 7px 0 !important;
        padding: 7px 10px !important;
        border: 1px solid var(--roli-total-border) !important;
        background-color: var(--roli-total-bg) !important;
        border-radius: 7px !important;
        color: inherit !important;
        font-family: Arial, Helvetica, sans-serif !important;
        line-height: 1 !important;
        overflow: hidden !important;
        clear: both !important;
        position: relative !important;
        z-index: 2 !important;
      }
      .${TOTAL_CLASS} .roli-total-label {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        opacity: .72 !important;
        font-size: 10px !important;
        line-height: 14px !important;
        font-weight: 700 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .${TOTAL_CLASS} .roli-value {
        flex: 0 0 auto !important;
        min-width: max-content !important;
        margin: 0 !important;
        padding: 0 !important;
        color: var(--roli-total-text) !important;
        font-size: 15px !important;
        line-height: 18px !important;
        font-weight: 800 !important;
        text-align: right !important;
        white-space: nowrap !important;
      }
      @media (max-width: 480px) {
        .${VALUE_CLASS} { padding: 4px 6px !important; }
        .${VALUE_CLASS} .roli-number { font-size: 12px !important; }
        .${TOTAL_CLASS} { gap: 8px !important; padding-left: 8px !important; padding-right: 8px !important; }
        .${TOTAL_CLASS} .roli-value { font-size: 14px !important; }
      }

      .roli-trade-readout { display:inline-flex !important; align-items:center !important; gap:5px !important; margin-left:8px !important; padding:3px 7px !important; border-radius:5px !important; font:700 11px/14px Arial,sans-serif !important; white-space:nowrap !important; vertical-align:middle !important; }
      .roli-trade-win { color:#16803a !important; background:rgba(22,128,58,.10) !important; border:1px solid rgba(22,128,58,.24) !important; }
      .roli-trade-loss { color:#b42318 !important; background:rgba(180,35,24,.10) !important; border:1px solid rgba(180,35,24,.24) !important; }
      .roli-trade-even { color:#666 !important; background:rgba(100,100,100,.08) !important; border:1px solid rgba(100,100,100,.18) !important; }
      /* Left-edge Win/Loss stripe + badge. Uses inset box-shadow only, so it never changes Roblox's layout. */
      .roli-rel { position:relative !important; }
      .roli-row-win  { box-shadow: inset 6px 0 0 #16a34a, inset 0 0 0 9999px rgba(22,163,74,.08) !important; }
      .roli-row-loss { box-shadow: inset 6px 0 0 #dc2626, inset 0 0 0 9999px rgba(220,38,38,.08) !important; }
      .roli-row-even { box-shadow: inset 6px 0 0 #9ca3af, inset 0 0 0 9999px rgba(156,163,175,.06) !important; }
      .roli-row-unk  { box-shadow: inset 6px 0 0 #f59e0b, inset 0 0 0 9999px rgba(245,158,11,.08) !important; }
      .roli-row-win::after, .roli-row-loss::after, .roli-row-even::after, .roli-row-unk::after { content:attr(data-roli-label); position:absolute; right:8px; top:50%; transform:translateY(-50%); padding:2px 7px; border-radius:4px; background:#0b0d10; border:1px solid currentColor; font:700 11px/14px Arial,sans-serif; white-space:nowrap; pointer-events:none; z-index:2; }
      .roli-row-win::after  { color:#22c55e; }
      .roli-row-loss::after { color:#ef4444; }
      .roli-row-even::after { color:#9ca3af; }
      .roli-row-unk::after  { color:#f59e0b; }
      .roli-trade-readout .roli-pct { opacity:.8 !important; font-weight:600 !important; }
      .roli-filter-bar { display:flex !important; flex-wrap:wrap !important; align-items:center !important; gap:10px !important; margin:10px 0 !important; padding:10px 12px !important; border-radius:8px !important; background:rgba(128,128,128,.12) !important; border:1px solid rgba(128,128,128,.35) !important; font:12px/16px Arial,sans-serif !important; }
      .roli-filter-bar label { display:flex !important; flex-direction:column !important; gap:3px !important; font-weight:700 !important; }
      .roli-filter-bar select, .roli-filter-bar input { background:#2b2f36 !important; color:#f1f3f5 !important; border:1px solid #4a505b !important; border-radius:6px !important; padding:6px 8px !important; font:13px/16px Arial,sans-serif !important; min-width:130px !important; }
      .roli-filter-bar input { min-width:170px !important; }
      .roli-filter-bar .roli-fb-note { margin-left:auto !important; opacity:.75 !important; align-self:flex-end !important; }
      .roli-filter-bar button { border:1px solid #4a505b !important; border-radius:6px !important; background:#2b2f36 !important; color:#f1f3f5 !important; padding:6px 10px !important; cursor:pointer !important; font:700 12px/16px Arial,sans-serif !important; align-self:flex-end !important; }
      .roli-filtered-out { display:none !important; }
      .roli-projected .roli-number { color:#f59e0b !important; }
      .roli-projected .roli-label { color:#f59e0b !important; }
      .roli-bulk-toolbar { display:flex !important; align-items:center !important; gap:8px !important; margin:10px 0 !important; padding:8px 10px !important; border-radius:7px !important; background:rgba(0,0,0,.04) !important; border:1px solid rgba(0,0,0,.12) !important; font:12px/16px Arial,sans-serif !important; }
      .roli-bulk-toolbar button { border:1px solid #aaa !important; border-radius:5px !important; background:#fff !important; color:#222 !important; padding:5px 9px !important; cursor:pointer !important; font:700 12px/16px Arial,sans-serif !important; }
      .roli-bulk-toolbar button:disabled { opacity:.45 !important; cursor:not-allowed !important; }
      .roli-trade-select { margin-right:7px !important; transform:scale(1.05) !important; vertical-align:middle !important; }

      #${POPUP_ID} { position:fixed; inset:0; z-index:2147483646; display:none; }
      #${POPUP_ID}.open { display:block; }
      #${POPUP_ID} .roli-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.48); }
      #${POPUP_ID} .roli-dialog { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(430px,calc(100vw - 28px)); box-sizing:border-box; padding:0; border-radius:10px; background:#fff; color:#222; box-shadow:0 12px 40px rgba(0,0,0,.35); font:14px/1.4 Arial,Helvetica,sans-serif; overflow:hidden; pointer-events:auto; }
      #${POPUP_ID} .roli-scroll { box-sizing:border-box; max-height:min(720px,calc(100vh - 28px)); overflow:auto; padding:18px; }
      #${POPUP_ID} .roli-close { position:absolute; right:8px; top:8px; z-index:10; width:32px; height:32px; padding:0; border:0; border-radius:50%; background:rgba(255,255,255,.95); box-shadow:0 0 0 1px rgba(0,0,0,.12); font-size:22px; line-height:30px; text-align:center; cursor:pointer; color:#444; pointer-events:auto; }
      #${POPUP_ID} .roli-close:hover { background:#eee; }
      #${POPUP_ID} .roli-backdrop { pointer-events:auto; }
      #${POPUP_ID} .roli-closebtn { border:1px solid #bbb; border-radius:5px; background:#f5f5f5; color:#222; padding:5px 14px; font:700 12px/16px Arial,sans-serif; cursor:pointer; }
      #${POPUP_ID} h2 { margin:0 34px 2px 0; font-size:19px; line-height:24px; }
      #${POPUP_ID} .roli-acronym { opacity:.6; margin-bottom:14px; }
      #${POPUP_ID} .roli-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      #${POPUP_ID} .roli-stat { border:1px solid #ddd; border-radius:7px; padding:9px; }
      #${POPUP_ID} .roli-stat b { display:block; font-size:10px; text-transform:uppercase; opacity:.6; margin-bottom:2px; }
      #${POPUP_ID} .roli-stat span { font-weight:700; }

      #${POPUP_ID} .roli-ranges { display:flex; gap:6px; margin:0 0 8px; }
      #${POPUP_ID} .roli-ranges button { border:1px solid #ccc; border-radius:5px; background:#fff; color:#333; padding:3px 9px; font:700 11px/14px Arial,sans-serif; cursor:pointer; }
      #${POPUP_ID} .roli-ranges button.active { background:#0b7fd0; border-color:#0b7fd0; color:#fff; }
      #${POPUP_ID} .roli-legend { display:flex; gap:12px; margin:0 0 4px; font-size:11px; color:#555; }
      #${POPUP_ID} .roli-legend i { display:inline-block; width:10px; height:3px; border-radius:2px; margin-right:5px; vertical-align:middle; }
      #${POPUP_ID} .roli-readout { min-height:16px; margin:0 0 4px; font-size:12px; font-weight:700; color:#222; }
      #${POPUP_ID} .roli-chart { display:block; width:100%; height:auto; touch-action:none; }
      #${POPUP_ID} .roli-graph-msg { padding:18px 0; color:#666; font-size:13px; }
      #${POPUP_ID} .roli-graph-link { display:inline-block; margin-top:10px; font-size:12px; font-weight:700; color:#0b7fd0; text-decoration:none; }
      #${POPUP_ID} .roli-dialog.roli-wide { width:min(680px,calc(100vw - 28px)); }
      #${POPUP_ID} .roli-sum { display:grid; grid-template-columns:repeat(auto-fit,minmax(105px,1fr)); gap:8px; margin:0 0 12px; }
      #${POPUP_ID} .roli-sc { border:1px solid #e3e3e3; border-left:3px solid var(--c); border-radius:7px; padding:6px 9px; }
      #${POPUP_ID} .roli-sc.off { opacity:.4; }
      #${POPUP_ID} .roli-sc b { display:block; font-size:10px; text-transform:uppercase; opacity:.6; }
      #${POPUP_ID} .roli-sc span { font-weight:800; font-size:15px; }
      #${POPUP_ID} .roli-sc em { font-style:normal; font-size:11px; font-weight:700; margin-left:6px; }
      #${POPUP_ID} .roli-sc em.up { color:#16803a; }
      #${POPUP_ID} .roli-sc em.down { color:#b42318; }
      #${POPUP_ID} .roli-sc em.flat { color:#888; font-weight:600; }
      #${POPUP_ID} .roli-toolbar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:8px; margin:0 0 6px; }
      #${POPUP_ID} .roli-toolbar .roli-ranges { margin:0; }
      #${POPUP_ID} .roli-chips { display:flex; flex-wrap:wrap; gap:6px; }
      #${POPUP_ID} .roli-chips button { display:inline-flex; align-items:center; gap:5px; border:1px solid #ccc; border-radius:999px; background:#fff; color:#333; padding:3px 9px; font:700 11px/14px Arial,sans-serif; cursor:pointer; }
      #${POPUP_ID} .roli-chips button i { width:9px; height:9px; border-radius:50%; display:inline-block; }
      #${POPUP_ID} .roli-chips button.off { opacity:.45; text-decoration:line-through; }
      #${POPUP_ID} .roli-readout { display:flex; flex-wrap:wrap; gap:2px 14px; min-height:34px; margin:0 0 4px; font-size:12px; font-weight:700; }
      #${POPUP_ID} .roli-rd-date { color:#222; }
      #${POPUP_ID} .roli-rd { display:inline-flex; align-items:center; gap:5px; color:#333; }
      #${POPUP_ID} .roli-rd i { width:8px; height:8px; border-radius:50%; display:inline-block; }
      #${POPUP_ID} .roli-foot { display:flex; justify-content:space-between; align-items:center; gap:10px; }
      #${POPUP_ID} .roli-note { margin-top:10px; font-size:11px; color:#888; }

      #${STATUS_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        max-width: min(320px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 8px 10px;
        border-radius: 7px;
        background: rgba(20,20,20,.94);
        color: #fff;
        font: 12px/16px Arial, sans-serif;
        box-shadow: 0 3px 14px rgba(0,0,0,.25);
        pointer-events: none;
      }
    `
    document.documentElement.appendChild(style);
  }

  function status(text, hide = false) {
    let el = document.getElementById(STATUS_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = STATUS_ID;
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.display = hide ? "none" : "block";
  }

  function getCatalogId(href) {
    if (!href) return null;
    const m = String(href).match(/(?:\/catalog\/|\/marketplace\/asset\/)(\d+)/i);
    return m ? m[1] : null;
  }

  let nameIndex = null;
  let nameIndexSource = null;
  function normName(n) { return String(n || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function getNameIndex() {
    if (!itemData?.items) return null;
    if (nameIndex && nameIndexSource === itemData.items) return nameIndex;
    nameIndex = new Map();
    nameIndexSource = itemData.items;
    const ambiguous = new Set();
    for (const [id, d] of Object.entries(itemData.items)) {
      if (!Array.isArray(d) || !d[0]) continue;
      const key = normName(d[0]);
      if (nameIndex.has(key)) ambiguous.add(key); else nameIndex.set(key, id);
    }
    // Several different items share these names, so a name can't tell us which one a card is.
    // Showing no value is better than showing another item's value.
    ambiguous.forEach(k => nameIndex.delete(k));
    return nameIndex;
  }

  function cardNameCandidates(card) {
    const out = [];
    const push = (v) => { const n = normName(v); if (n) out.push(n); };
    card.querySelectorAll?.('.item-card-name, [class*="item-card-name"], .item-card-caption .text-overflow, [class*="item-name"], [class*="itemName"]').forEach(el => { push(el.getAttribute("title")); push(el.textContent); });
    card.querySelectorAll?.('img[alt], img[title]').forEach(img => { push(img.getAttribute("alt")); push(img.getAttribute("title")); });
    return out;
  }

  // The card's own item id (data attribute or catalog link). This is exact; a name is only a guess.
  function getExplicitCardId(card) {
    if (!card) return null;
    const dataAttrs = ["data-item-id", "data-asset-id", "data-catalog-id"];
    for (const attr of dataAttrs) {
      const value = card.getAttribute?.(attr) || card.querySelector?.(`[${attr}]`)?.getAttribute(attr);
      if (value && /^\d+$/.test(String(value))) return String(value);
    }
    const link = card.matches?.('a[href*="/catalog/"], a[href*="/marketplace/asset/"]') ? card : card.querySelector?.('a[href*="/catalog/"], a[href*="/marketplace/asset/"]');
    return getCatalogId(link?.getAttribute("href") || link?.href);
  }

  function getItemIdFromCard(card) {
    const explicit = getExplicitCardId(card);
    if (explicit) return explicit;

    // Inventory cards in the trade window often have no catalog link, so
    // fall back to matching the displayed item name against Rolimon's data.
    const idx = getNameIndex();
    if (idx) {
      for (const n of cardNameCandidates(card)) {
        const hit = idx.get(n);
        if (hit) return hit;
      }
    }
    return null;
  }

  const hostIdHint = new WeakMap();
  const nameElHint = new WeakMap();
  const OURS_SELECTOR = `.${VALUE_CLASS}, .${TOTAL_CLASS}, .roli-value-footer, .roli-trade-readout, .roli-bulk-toolbar, .roli-filter-bar, .roli-filter-results, #${POPUP_ID}, #${STATUS_ID}`;

  // Layout-agnostic scan: find any element whose text/alt/title is exactly a
  // Rolimon's item name, then climb to the card that contains only that item.
  function scanCardsByName(root) {
    const idx = getNameIndex();
    if (!idx) return [];
    const matches = []; // { el, id }
    const seen = new Set();
    const consider = (el, text) => {
      const key = normName(text);
      if (!key || key.length > 80) return;
      const id = idx.get(key);
      if (!id || seen.has(el)) return;
      if (el.closest?.(OURS_SELECTOR)) return;
      seen.add(el);
      matches.push({ el, id });
    };
    root.querySelectorAll('img[alt], img[title]').forEach(img => {
      consider(img, img.getAttribute('alt'));
      consider(img, img.getAttribute('title'));
    });
    root.querySelectorAll('span, div, p, a, h3, h4, h5, li').forEach(el => {
      if (el.childElementCount > 1) return;
      if (el.childElementCount === 1 && el.firstElementChild.tagName !== 'SPAN' && el.firstElementChild.tagName !== 'B') return;
      const t = el.textContent;
      if (!t || t.length > 80) return;
      consider(el, t);
      const title = el.getAttribute('title') || el.getAttribute('aria-label');
      if (title) consider(el, title);
    });
    if (!matches.length) return [];

    const matchEls = matches.map(m => m.el);
    const containsOther = (node, self) => matchEls.some(o => o !== self && node.contains(o));
    const result = [];
    for (const m of matches) {
      let best = null;
      let el = m.el;
      for (let i = 0; i < 8 && el && el !== document.body; i++, el = el.parentElement) {
        if (el !== m.el && containsOther(el, m.el)) {
          // Another item lives in here, unless it's the same item (image + caption).
          const others = matches.filter(o => o.el !== m.el && el.contains(o.el) && o.id !== m.id);
          if (others.length) break;
        }
        if (/^(UL|OL|BODY|HTML|MAIN|SECTION)$/.test(el.tagName)) break;
        const r = el.getBoundingClientRect();
        if (r.width > 340 || r.height > 520) break;
        if (el !== m.el && (r.width >= 40 && r.height >= 40)) best = el;
        if (el.matches?.('.item-card-container')) { best = el; break; }
      }
      if (best) {
        if (!hostIdHint.has(best)) hostIdHint.set(best, m.id);
        if (m.el.tagName !== 'IMG' && !nameElHint.has(best)) nameElHint.set(best, m.el);
        result.push(best);
      }
    }
    return result;
  }

  const CARD_SELECTOR = '.item-card-container, .item-card, [class*="item-card-container"], .list-item, [role="listitem"]';

  function getItemHosts(root) {
    const hosts = new Set();
    const add = (host) => {
      if (!host || host.closest?.(`#${POPUP_ID}`)) return;
      hosts.add(host);
    };

    const links = root.querySelectorAll?.('a[href*="/catalog/"], a[href*="/marketplace/asset/"]') || [];
    for (const link of links) {
      let host = link.closest?.(CARD_SELECTOR);
      const outerCard = link.closest?.('.item-card-container');
      if (outerCard) host = outerCard;
      if (!host) {
        let el = link.parentElement;
        for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
          if (el.querySelector?.('.item-card-caption, .item-card-name')) { host = el; break; }
        }
      }
      add(host || link.parentElement || link);
    }

    // Cards without a catalog link (e.g. inventory inside the trade window).
    const names = root.querySelectorAll?.('.item-card-name, [class*="item-card-name"]') || [];
    for (const nameEl of names) {
      const host = nameEl.closest?.('.item-card-container') || nameEl.closest?.(CARD_SELECTOR);
      add(host);
    }

    for (const host of scanCardsByName(root)) add(host);

    // Drop hosts that contain other hosts (too broad) or are nested in one.
    const list = [...hosts].filter(h => !h.matches?.('.roli-inventory-item-wrap') && !h.closest?.('.roli-value-footer'));
    // When nested: prefer Roblox's own .item-card-container, otherwise the smallest.
    const isCard = (h) => h.matches?.('.item-card-container');
    const pruned = list.filter(o => !list.some(h => h !== o && isCard(h) && h.contains(o)));
    return pruned.filter(h => !pruned.some(o => o !== h && h.contains(o) && !isCard(h)));
  }

  function rawItem(id) {
    const d = itemData?.items?.[id];
    return Array.isArray(d) ? d : null;
  }

  function enumText(value, labels) {
    const n = Number(value);
    if (n === -1) return "None";
    return Object.prototype.hasOwnProperty.call(labels, n) ? labels[n] : String(value ?? "None");
  }

  function flagText(value) {
    if (value === true || value === 1 || value === "1" || value === "true") return "Yes";
    if (value === false || value === 0 || value === "0" || value === "false" || value == null || value === -1 || value === "-1") return "None";
    return String(value);
  }

  function numericItemField(value) {
    if (value == null || value === "") return null;
    const n = Number(String(value).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function hasPositiveSetValue(d) {
    if (!Array.isArray(d)) return false;
    const n = numericItemField(d[3]);
    return n != null && n > 0;
  }

  // Items Rolimon's doesn't list (or lists with no value/RAP) fall back to Roblox's own RAP.
  const liveRapCache = new Map();      // id -> RAP, or null when Roblox has none
  const liveRapPromises = new Map();
  function liveRapFor(id) {
    const key = String(id);
    if (!/^\d+$/.test(key)) return Promise.resolve(null);
    if (liveRapCache.has(key)) return Promise.resolve(liveRapCache.get(key));
    if (!liveRapPromises.has(key)) {
      liveRapPromises.set(key, browser.runtime.sendMessage({ type: "getLiveRap", id: key })
        .then(r => (r?.ok && r.rap > 0 ? r.rap : null)).catch(() => null)
        .then(v => { liveRapCache.set(key, v); liveRapPromises.delete(key); if (v) scheduleRender(100); return v; }));
    }
    return liveRapPromises.get(key);
  }
  function recordValue(d) {
    const rap = numericItemField(d?.[2]), set = numericItemField(d?.[3]);
    return set != null && set > 0 ? set : (rap != null && rap > 0 ? rap : 0);
  }
  function needsFallback(id) { const d = rawItem(id); return !d || !(recordValue(d) > 0); }
  function fallbackInfo(id) {
    liveRapFor(id);
    const rap = liveRapCache.get(String(id));
    if (!(rap > 0)) return null;
    return { id, name: `Item ${id}`, acronym: "", rap, value: rap, hasSet: false, demand: "None", trend: "None", projected: "None", rare: "None", fromRoblox: true };
  }

  function getItemInfo(id) {
    const d = rawItem(id);
    if (!d) return fallbackInfo(id);

    // Rolimon's v2 itemdetails fields: [name, acronym, RAP, Value, ...].
    // Value == -1 (or another missing/non-numeric value) means there is no
    // assigned/set value. In that case RAP is the effective value. A real
    // set Value must always win over RAP.
    const rapNumber = numericItemField(d[2]);
    const rap = rapNumber != null && rapNumber >= 0 ? rapNumber : 0;
    const setValueNumber = numericItemField(d[3]);
    // Rolimon's uses -1/0/missing for items without an assigned Value.
    // Those items must use RAP as their effective Value everywhere, including
    // the inventory renderer. Only a strictly positive set Value overrides RAP.
    const hasSetValue = setValueNumber != null && setValueNumber > 0;
    const value = hasSetValue ? setValueNumber : rap;
    if (!(value > 0)) {
      const fb = fallbackInfo(id);
      if (fb) return { ...fb, name: d[0] || fb.name, acronym: d[1] || "" };
    }

    return {
      id, name: d[0] || `Item ${id}`, acronym: d[1] || "", rap, value, hasSet: hasSetValue,
      demand: enumText(d[5], {0:"Terrible",1:"Low",2:"Normal",3:"High",4:"Amazing"}),
      trend: enumText(d[6], {0:"Lowering",1:"Unstable",2:"Stable",3:"Raising",4:"Fluctuating"}),
      projected: flagText(d[7]), rare: flagText(d[9])
    };
  }

  async function getRoutilityValue(id) {
    if (!routilityEnabled) return null;
    const key = String(id);
    const cached = routilityCache.get(key);
    if (cached && Date.now() - cached.at < ROUTILITY_CACHE_TTL) return cached.value;
    try {
      const result = await browser.runtime.sendMessage({ type: "getRoutilityValue", id: key });
      const value = Number(result?.value);
      if (!result?.ok || !Number.isFinite(value) || value <= 0) return null;
      routilityCache.set(key, { value, at: Date.now() });
      return value;
    } catch (_) {
      return null;
    }
  }

  async function getRoutilityStats(id) {
    const key = String(id);
    const cached = routilityStatsCache.get(key);
    if (cached && Date.now() - cached.at < ROUTILITY_CACHE_TTL) return cached.stats;
    const result = await browser.runtime.sendMessage({ type: "getRoutilityStats", id: key });
    if (!result?.ok || !result.stats) throw new Error(result?.error || "No RoUtility data");
    routilityStatsCache.set(key, { stats: result.stats, at: Date.now() });
    return result.stats;
  }

  function getRoutilityLabel(card) {
    return card?.querySelector?.('.roli-routility-value');
  }

  function closePopup() {
    const popup = document.getElementById(POPUP_ID);
    if (!popup) return;
    graphToken++;
    popup.classList.remove("open");
    popup.style.setProperty("display", "none", "important");
  }

  function openPopup(popup) {
    popup.classList.add("open");
    popup.style.setProperty("display", "block", "important");
  }

  function ensurePopup() {
    let popup = document.getElementById(POPUP_ID);
    if (popup) return popup;
    popup = document.createElement("div"); popup.id = POPUP_ID;
    popup.innerHTML = `<div class="roli-backdrop"></div><div class="roli-dialog" role="dialog" aria-modal="true"><button class="roli-close" type="button" aria-label="Close" title="Close (Esc)">\u00d7</button><div class="roli-scroll"><div class="roli-content"></div></div></div>`;
    document.documentElement.appendChild(popup);
    const shut = (e) => { e.preventDefault(); e.stopPropagation(); closePopup(); };
    for (const sel of [".roli-backdrop", ".roli-close"]) {
      const n = popup.querySelector(sel);
      n.addEventListener("pointerdown", shut, true);
      n.addEventListener("click", shut, true);
    }
    popup.addEventListener("pointerdown", (e) => { if (e.target === popup) shut(e); }, true);
    return popup;
  }

  // Esc closes the popup no matter what the Roblox page is doing.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const popup = document.getElementById(POPUP_ID);
    if (popup && popup.classList.contains("open")) { e.stopPropagation(); closePopup(); }
  }, true);

  function showPopup(id) {
    graphToken++;
    const info = getItemInfo(id);
    if (!info) return;
    const popup = ensurePopup();
    popup.querySelector(".roli-dialog").classList.remove("roli-wide");
    const c = popup.querySelector(".roli-content");
    c.innerHTML = `<h2></h2><div class="roli-acronym"></div><div class="roli-grid"></div>`;
    c.querySelector("h2").textContent = info.name;
    c.querySelector(".roli-acronym").textContent = info.acronym ? `Acronym: ${info.acronym}` : `Asset ID: ${id}`;
    const stats = [["RAP",fmt(info.rap)],["Value",fmt(info.value)],["Demand",info.demand],["Trend",info.trend],["Projected",info.projected],["Rare",info.rare]];
    const grid = c.querySelector(".roli-grid");
    for (const [k,v] of stats) { const el=document.createElement("div"); el.className="roli-stat"; el.innerHTML=`<b></b><span></span>`; el.querySelector("b").textContent=k; el.querySelector("span").textContent=v; grid.appendChild(el); }

    if (routilityStatsEnabled) {
      const token = graphToken;
      const head = document.createElement("div");
      head.className = "roli-acronym";
      head.style.setProperty("margin", "16px 0 8px");
      head.textContent = "RoUtility";
      const rgrid = document.createElement("div");
      rgrid.className = "roli-grid";
      const note = document.createElement("div");
      note.className = "roli-graph-msg";
      note.textContent = "Loading RoUtility stats\u2026";
      c.append(head, note);
      getRoutilityStats(id).then(rs => {
        if (token !== graphToken || !popup.classList.contains("open")) return;
        const show = (v, f) => v == null ? "N/A" : (f ? f(v) : String(v));
        const rows = [
          ["USD", show(rs.usd ?? rs.value, formatRoutility)],
          ["RAP", show(rs.rap, fmt)],
          ["Copies", show(rs.copies, fmt)],
          ["Demand", show(rs.demand)],
          ["Trend", show(rs.trend)]
        ];
        for (const [k, v] of rows) {
          const el = document.createElement("div"); el.className = "roli-stat";
          el.innerHTML = `<b></b><span></span>`;
          el.querySelector("b").textContent = k; el.querySelector("span").textContent = v;
          rgrid.appendChild(el);
        }
        const link = document.createElement("a");
        link.className = "roli-graph-link";
        link.href = `https://routility.io/catalog/${encodeURIComponent(id)}`;
        link.target = "_blank"; link.rel = "noopener noreferrer";
        link.textContent = "Open on RoUtility \u2197";
        note.replaceWith(rgrid, link);
      }).catch(err => {
        if (token !== graphToken) return;
        note.textContent = `Couldn't load RoUtility stats (${err.message}).`;
      });
    }
    openPopup(popup);
  }

  // ---- Graph popup (Rolimon's RAP + best price history) ----
  let graphToken = 0;
  const graphCache = new Map();
  const GRAPH_CACHE_TTL = 10 * 60 * 1000;
  const GRAPH_RANGES = [["7D", 7], ["30D", 30], ["90D", 90], ["1Y", 365], ["All", 0]];

  async function getGraphData(id) {
    const key = String(id);
    const hit = graphCache.get(key);
    if (hit && Date.now() - hit.at < GRAPH_CACHE_TTL) return hit.data;
    const result = await browser.runtime.sendMessage({ type: "getRolimonsHistory", id: key });
    if (!result?.ok || !result.data) throw new Error(result?.error || "No history returned");
    graphCache.set(key, { data: result.data, at: Date.now() });
    return result.data;
  }

  function fmtShort(n) {
    const a = Math.abs(n);
    const trim = (x) => x.replace(/\.0$/, "");
    if (a >= 1e9) return trim((n / 1e9).toFixed(1)) + "B";
    if (a >= 1e6) return trim((n / 1e6).toFixed(1)) + "M";
    if (a >= 1e5) return Math.round(n / 1e3) + "K";
    if (a >= 1e3) return trim((n / 1e3).toFixed(1)) + "K";
    return String(Math.round(n));
  }

  function graphLink(id) {
    const a = document.createElement("a");
    a.className = "roli-graph-link";
    a.href = `https://www.rolimons.com/item/${encodeURIComponent(id)}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open on Rolimon's \u2197";
    return a;
  }

  function showGraph(id) {
    const info = getItemInfo(id);
    const popup = ensurePopup();
    const c = popup.querySelector(".roli-content");
    const token = ++graphToken;
    popup.querySelector(".roli-dialog").classList.add("roli-wide");
    c.innerHTML = `<h2></h2><div class="roli-acronym">Price &amp; sales history</div><div class="roli-graph-body"><div class="roli-graph-msg">Loading graph\u2026</div></div>`;
    c.querySelector("h2").textContent = info ? info.name : `Item ${id}`;
    const body = c.querySelector(".roli-graph-body");
    openPopup(popup);
    getGraphData(id).then(data => {
      if (token !== graphToken || !popup.classList.contains("open")) return;
      renderGraph(body, data, id);
    }).catch(err => {
      if (token !== graphToken) return;
      body.textContent = "";
      const msg = document.createElement("div");
      msg.className = "roli-graph-msg";
      msg.textContent = `Couldn't load the graph (${err.message}).`;
      body.append(msg, graphLink(id));
    });
  }

  function renderGraph(body, data, id) {
    body.textContent = "";
    const NS = "http://www.w3.org/2000/svg";
    const W = 600, L = 52, R = 12, T = 10, H1 = 230, GAP = 16, H2 = 54, AX = 22;
    const H = T + H1 + GAP + H2 + AX;
    const PB = T + H1;                 // bottom of price panel
    const VT = PB + GAP, VB = VT + H2; // top / bottom of volume panel
    const toSec = (t) => (t > 1e12 ? t / 1000 : t);
    const ts = data.t.map(toSec);
    const sales = data.sales && data.sales.t && data.sales.t.length
      ? { t: data.sales.t.map(toSec), price: data.sales.price, vol: data.sales.vol } : null;

    const SERIES = [
      { key: "rap", label: "RAP", color: "#0b7fd0", t: ts, v: data.rap, type: "line", on: true },
      { key: "price", label: "Best price", color: "#e08a00", t: ts, v: data.price, type: "line", on: true }
    ];
    if (sales && sales.price) SERIES.push({ key: "sale", label: "Avg sale price", color: "#16a34a", t: sales.t, v: sales.price, type: "dots", on: true });
    if (sales && sales.vol) SERIES.push({ key: "vol", label: "Sales / day", color: "#8b95a5", t: sales.t, v: sales.vol, type: "bars", on: true });
    const hasSales = SERIES.some(s => s.key === "sale" || s.key === "vol");

    let range = 90;
    let view = null;

    const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    const el = (name, attrs, text) => {
      const n = document.createElementNS(NS, name);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      return n;
    };
    const dateStr = (t, withYear) => new Date(t * 1000).toLocaleDateString(undefined, withYear ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
    const val = (v) => (v == null ? "\u2014" : fmt(v));
    const niceTicks = (min, max, n) => {
      const span = max - min || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
      const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
      const out = [];
      const first = Math.floor(min / step + 1e-9);
      for (let k = first; ; k++) { out.push(Math.round(k * step * 1e6) / 1e6); if (k * step >= max - step * 1e-6) break; }
      out.step = step;
      return out;
    };
    // Axis label that never rounds a tick to a wrong number (1.05K stays 1.05K).
    const axisFmt = (v, step, peak) => {
      const unit = peak >= 1e9 ? 1e9 : peak >= 1e6 ? 1e6 : peak >= 1e4 ? 1e3 : 1;
      const suf = unit === 1e9 ? "B" : unit === 1e6 ? "M" : unit === 1e3 ? "K" : "";
      const dec = Math.min(3, Math.max(0, Math.ceil(-Math.log10(step / unit) - 1e-9)));
      return (v / unit).toFixed(dec) + suf;
    };

    // ---- layout ----
    const summary = h("div", "roli-sum");
    const toolbar = h("div", "roli-toolbar");
    const ranges = h("div", "roli-ranges");
    const chips = h("div", "roli-chips");
    toolbar.append(ranges, chips);
    const readout = h("div", "roli-readout");
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "roli-chart");
    const foot = h("div", "roli-foot");
    foot.append(graphLink(id));
    const note = h("span", "roli-note");
    const lastOf = (a) => a.t[a.t.length - 1];
    note.textContent = hasSales
      ? `Price data through ${dateStr(ts[ts.length - 1], true)} (UTC)` + (sales ? ` \u00b7 sales through ${dateStr(lastOf(sales), true)}` : "")
      : `Price data through ${dateStr(ts[ts.length - 1], true)} (UTC) \u00b7 ` + (String(data.salesInfo || "none") === "none"
          ? "Rolimon's has no sales data for this item"
          : `sales data couldn't be read (${data.salesInfo})`);
    foot.append(note);
    const closeBtn = h("button", "roli-closebtn", "Close");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", closePopup);
    foot.append(closeBtn);
    body.append(summary, toolbar, readout, svg, foot);

    for (const [label, days] of GRAPH_RANGES) {
      const b = h("button", null, label);
      b.type = "button";
      b.classList.toggle("active", days === range);
      b.addEventListener("click", () => {
        range = days;
        ranges.querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
        draw();
      });
      ranges.appendChild(b);
    }
    for (const s of SERIES) {
      const b = h("button", null);
      b.type = "button";
      b.title = `Show / hide ${s.label}`;
      const dot = h("i"); dot.style.background = s.color;
      b.append(dot, document.createTextNode(s.label));
      b.addEventListener("click", () => { s.on = !s.on; b.classList.toggle("off", !s.on); draw(); });
      chips.appendChild(b);
    }

    function inRange(s, t0, t1) {
      const idx = [];
      for (let i = 0; i < s.t.length; i++) if (s.t[i] >= t0 && s.t[i] <= t1 && s.v[i] != null) idx.push(i);
      return idx;
    }
    function nearest(s, idx, t) {
      let best = -1, bd = Infinity;
      for (const i of idx) { const d = Math.abs(s.t[i] - t); if (d < bd) { bd = d; best = i; } }
      return best;
    }

    function draw() {
      svg.textContent = "";
      const endT = Math.max(...SERIES.map(s => s.t[s.t.length - 1]));
      const startAll = Math.min(...SERIES.map(s => s.t[0]));
      const t1 = endT;
      const t0 = range ? Math.max(endT - range * 86400, startAll) : startAll;
      const X = (t) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
      for (const s of SERIES) s.idx = inRange(s, t0, t1);

      // summary cards (always reflect the selected range)
      summary.textContent = "";
      for (const s of SERIES) {
        const card = h("div", "roli-sc");
        card.style.setProperty("--c", s.color);
        card.append(h("b", null, s.label));
        const partial = s.t.length && s.t[0] > t0 + 86400;   // series starts after the window does
        if (s.type === "bars") {
          const total = s.idx.reduce((a, i) => a + s.v[i], 0);
          card.append(h("span", null, s.idx.length ? total.toLocaleString() : "\u2014"),
            h("em", "flat", partial ? `sold since ${dateStr(s.t[0], true)}` : `sold in ${range ? range + "d" : "all time"}`));
        } else {
          const lastI = s.idx.length ? s.idx[s.idx.length - 1] : -1;
          const last = lastI >= 0 ? s.v[lastI] : null;
          const first = s.idx.length ? s.v[s.idx[0]] : null;
          card.append(h("span", null, val(last)));
          if (s.type === "dots" && lastI >= 0 && t1 - s.t[lastI] > 2 * 86400) {
            card.append(h("em", "flat", `on ${dateStr(s.t[lastI], false)}`));
          } else if (last != null && first != null && first > 0 && s.idx.length > 1) {
            const pct = ((last - first) / first) * 100;
            const em = h("em", pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat", `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`);
            if (partial) em.title = `Change since ${dateStr(s.t[s.idx[0]], true)} (data starts there)`;
            card.append(em);
          }
        }
        if (!s.on) card.classList.add("off");
        summary.append(card);
      }

      const lineSeries = SERIES.filter(s => s.on && s.type !== "bars" && s.idx.length);
      const volSeries = SERIES.find(s => s.type === "bars" && s.on && s.idx.length);
      const ys = [];
      for (const s of lineSeries) for (const i of s.idx) ys.push(s.v[i]);
      if (!ys.length && !volSeries) {
        view = null; readout.textContent = "";
        svg.append(el("text", { x: W / 2, y: H / 2, "text-anchor": "middle", fill: "#777", "font-size": 13 }, SERIES.some(s => s.on) ? "Not enough data for this range" : "Turn on a series above"));
        return;
      }

      // price panel
      let Y = () => PB;
      if (ys.length) {
        let yMin = Math.min(...ys), yMax = Math.max(...ys);
        if (yMin === yMax) { yMin *= 0.95; yMax *= 1.05; }
        const pad = (yMax - yMin) * 0.08;
        const ticks = niceTicks(Math.max(0, yMin - pad), yMax + pad, 4);
        yMin = ticks[0]; yMax = ticks[ticks.length - 1];
        const peak = Math.max(Math.abs(yMin), Math.abs(yMax));
        Y = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * H1;
        for (const v of ticks) {
          const y = Y(v);
          svg.append(el("line", { x1: L, x2: W - R, y1: y, y2: y, stroke: "#ececec", "stroke-width": 1 }));
          svg.append(el("text", { x: L - 6, y: y + 3, "text-anchor": "end", fill: "#777", "font-size": 10 }, axisFmt(v, ticks.step, peak)));
        }
      }

      // x-axis labels + vertical guides
      const withYear = !range || range >= 365;
      const nX = 5;
      for (let k = 0; k < nX; k++) {
        const t = t0 + ((t1 - t0) * k) / (nX - 1);
        svg.append(el("line", { x1: X(t), x2: X(t), y1: T, y2: VB, stroke: "#f3f3f3", "stroke-width": 1 }));
        svg.append(el("text", { x: X(t), y: H - 6, "text-anchor": k === 0 ? "start" : k === nX - 1 ? "end" : "middle", fill: "#777", "font-size": 10 }, dateStr(t, withYear)));
      }

      // volume panel
      let VY = () => VB;
      if (volSeries) {
        const vMax = Math.max(1, ...volSeries.idx.map(i => volSeries.v[i]));
        VY = (v) => VB - (v / vMax) * H2;
        svg.append(el("line", { x1: L, x2: W - R, y1: VB, y2: VB, stroke: "#ddd", "stroke-width": 1 }));
        svg.append(el("text", { x: L - 6, y: VT + 8, "text-anchor": "end", fill: "#777", "font-size": 10 }, fmtShort(vMax)));
        svg.append(el("text", { x: L - 6, y: VB, "text-anchor": "end", fill: "#777", "font-size": 10 }, "0"));
        svg.append(el("text", { x: L + 4, y: VT + 9, fill: "#999", "font-size": 9 }, "Sales per day"));
        const dayW = ((W - L - R) * 86400) / (t1 - t0 || 1);
        const bw = Math.max(1, Math.min(14, dayW * 0.7));
        for (const i of volSeries.idx) {
          const v = volSeries.v[i];
          if (v <= 0) continue;
          const y = VY(v);
          svg.append(el("rect", { x: (X(volSeries.t[i]) - bw / 2).toFixed(1), y: y.toFixed(1), width: bw.toFixed(1), height: Math.max(1, VB - y).toFixed(1), fill: volSeries.color, opacity: 0.75 }));
        }
      }

      // lines
      const drawLine = (s) => {
        let d = "", pen = false;
        for (let i = 0; i < s.t.length; i++) {
          if (s.t[i] < t0 || s.t[i] > t1) continue;
          const v = s.v[i];
          if (v == null) { pen = false; continue; }
          d += `${pen ? "L" : "M"}${X(s.t[i]).toFixed(1)},${Y(v).toFixed(1)} `;
          pen = true;
        }
        if (d) svg.append(el("path", { d, fill: "none", stroke: s.color, "stroke-width": s.type === "dots" ? 1.4 : 1.8, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: s.type === "dots" ? 0.9 : 1 }));
      };
      // draw order: sales (back) -> best price -> RAP (front)
      for (const key of ["sale", "price", "rap"]) { const s = lineSeries.find(x => x.key === key); if (s) drawLine(s); }
      const sale = lineSeries.find(x => x.key === "sale");
      if (sale) {
        const r = sale.idx.length > 200 ? 1.4 : sale.idx.length > 90 ? 1.8 : 2.4;
        for (const i of sale.idx) svg.append(el("circle", { cx: X(sale.t[i]).toFixed(1), cy: Y(sale.v[i]).toFixed(1), r, fill: sale.color }));
      }

      // hover layer
      const cursor = el("line", { y1: T, y2: VB, stroke: "#888", "stroke-width": 1, "stroke-dasharray": "3 3", visibility: "hidden" });
      const dots = new Map();
      for (const s of lineSeries) { const c = el("circle", { r: 4, fill: s.color, stroke: "#fff", "stroke-width": 1.5, visibility: "hidden" }); dots.set(s.key, c); }
      svg.append(cursor, ...dots.values());
      view = { X, Y, t0, t1, cursor, dots, lineSeries };
      show(t1, false);
    }

    function show(t, hover) {
      readout.textContent = "";
      const DAY = 86400;
      const lines = SERIES.filter(s => s.type === "line" && s.on && s.idx && s.idx.length);
      const pool = lines.length ? lines : SERIES.filter(s => s.on && s.idx && s.idx.length);
      let shownDate = null, bd = Infinity;
      for (const s of pool) {
        const i = nearest(s, s.idx, t);
        if (i < 0) continue;
        const d = Math.abs(s.t[i] - t);
        if (d < bd) { bd = d; shownDate = s.t[i]; }
      }
      if (shownDate == null) return;
      readout.append(h("span", "roli-rd-date", dateStr(shownDate, true)));
      const picks = [];
      for (const s of SERIES) {
        if (!s.on) continue;
        let i = s.idx && s.idx.length ? nearest(s, s.idx, shownDate) : -1;
        if (s.type !== "line") {
          // Daily sales series: look up that series' own calendar day (including days with
          // no sales, whose price is null), so a quiet day shows a dash instead of
          // borrowing a neighbouring day's number. Outside the series' dates -> dash.
          let bi = -1, bdist = Infinity;
          for (let k = 0; k < s.t.length; k++) { const d = Math.abs(s.t[k] - shownDate); if (d < bdist) { bdist = d; bi = k; } }
          i = bi >= 0 && bdist <= 0.75 * DAY ? bi : -1;
        }
        picks.push([s, i]);
        const item = h("span", "roli-rd");
        const dot = h("i"); dot.style.background = s.color;
        let txt;
        if (i < 0) txt = "\u2014";
        else if (s.type === "bars") txt = s.v[i] == null ? "\u2014" : s.v[i].toLocaleString();
        else txt = val(s.v[i]);
        if (i >= 0 && s.type === "line" && Math.abs(s.t[i] - shownDate) > 1.5 * DAY) txt += ` (${dateStr(s.t[i], false)})`;
        item.append(dot, document.createTextNode(`${s.label} ${txt}`));
        readout.append(item);
      }
      if (!view) return;
      const x = view.X(shownDate);
      view.cursor.setAttribute("visibility", hover ? "visible" : "hidden");
      view.cursor.setAttribute("x1", x); view.cursor.setAttribute("x2", x);
      for (const s of view.lineSeries) {
        const node = view.dots.get(s.key);
        const pick = picks.find(p => p[0] === s);
        if (!hover || !pick || pick[1] < 0 || s.v[pick[1]] == null) { node.setAttribute("visibility", "hidden"); continue; }
        node.setAttribute("cx", view.X(s.t[pick[1]]));
        node.setAttribute("cy", view.Y(s.v[pick[1]]));
        node.setAttribute("visibility", "visible");
      }
    }

    const onMove = (e) => {
      if (!view) return;
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const f = Math.min(1, Math.max(0, (px - L) / (W - L - R)));
      show(view.t0 + f * (view.t1 - view.t0), true);
    };
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerdown", onMove);
    svg.addEventListener("pointerleave", () => { if (view) show(view.t1, false); });
    draw();
  }

  function findRoot() {
    return (
      document.querySelector('[data-testid="trade-page"]') ||
      document.querySelector("#trade-page") ||
      document.querySelector(".trade-page") ||
      document.querySelector("#container-main") ||
      document.body
    );
  }

  function findTotalRows(root) {
    const rows = [...root.querySelectorAll("div.robux-line")];
    return rows.filter((row) => {
      if (row.classList.contains(TOTAL_CLASS)) return false;
      const text = (row.textContent || "").replace(/\s+/g, " ").trim();
      return text === "Total Value:" || text.includes("Total Value:");
    });
  }

  function rect(el) {
    const r = el?.getBoundingClientRect?.();
    return r && r.width >= 1 && r.height >= 1 ? r : null;
  }

  function isTradeComposerCard(card) {
    if (!card) return false;
    let el = card;
    for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
      const cls = String(el.className || '').toLowerCase();
      if (/offer|trade.*modal|modal.*trade|trade.*container|trade.*window/.test(cls)) return true;
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if ((txt.includes('your offer') || txt.includes('their offer')) && txt.length < 2500) return true;
    }
    return false;
  }

  // 'inventory' = explicitly inside an inventory panel, 'offer' = inside an
  // offer slot, 'other' = anything else (trade detail pages, etc).
  function classifyCard(card) {
    let el = card;
    for (let i = 0; i < 12 && el; i++, el = el.parentElement) {
      const raw = el.className;
      const cls = String(typeof raw === "string" ? raw : raw?.baseVal || "").toLowerCase();
      const id = String(el.id || "").toLowerCase();
      if (/inventory|backpack/.test(cls) || /inventory|backpack/.test(id)) return "inventory";
      if (/offer/.test(cls)) return "offer";
    }
    return isTradeComposerCard(card) ? "offer" : "other";
  }

  function markGrown(card) {
    let el = card;
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      if (i === 0 || el.matches?.('.item-card-container, .item-card, [class*="item-card-container"], li.list-item')) el.classList.add("roli-grown");
      else break;
    }
  }

  // Let any fixed-height ancestor of an offer card (the bordered slot) grow
  // to its real content height so the values never spill out of the slot.
  function growSlot(card) {
    const run = () => {
      let el = card;
      for (let i = 0; i < 6 && el && el !== document.body; i++, el = el.parentElement) {
        if (i > 0 && el.querySelectorAll('img').length > 1) break;
        if (i === 0 || el.scrollHeight > el.clientHeight + 1) el.classList.add('roli-grown');
      }
    };
    run();
    if (growTimers.has(card)) return;
    growTimers.add(card);
    requestAnimationFrame(() => requestAnimationFrame(run));
    setTimeout(run, 400);
    setTimeout(run, 1500);
  }
  const growTimers = new WeakSet();

  // Roblox draws the serial (#139) / unique-icon chip at the bottom-left of the
  // thumbnail, which is where our badge sits. Lift it to the top-left, enlarged,
  // so the serial stays clearly readable and nothing overlaps.
  function liftSerials(thumb, footer) {
    if (!thumb || thumb.dataset.roliSerialPass === '2') return;
    const tr = thumb.getBoundingClientRect();
    if (tr.width < 40 || tr.height < 40) return;
    const marked = [];
    for (const el of thumb.querySelectorAll('*')) {
      if (el === footer || footer.contains(el) || el.closest('.roli-value-footer')) continue;
      if (/^(IMG|SVG|PATH|INPUT|BUTTON)$/i.test(el.tagName)) continue;
      if (el.classList.contains('roli-serial') || marked.some(m => m.contains(el))) continue;
      if (el.querySelector('img') ) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.width > 120 || r.height > 40) continue;
      const nearBottom = r.top > tr.top + tr.height * 0.6;
      const nearLeft = r.left < tr.left + tr.width * 0.5;
      const txt = (el.textContent || '').trim();
      const serialLike = /^#\s?\d+$/.test(txt);
      const iconChip = !txt && !!el.querySelector('svg, [class*="icon"]');
      if (nearBottom && nearLeft && (serialLike || (txt === '' && iconChip) || /#\s?\d+/.test(txt))) {
        el.classList.add('roli-serial');
        marked.push(el);
      }
    }
    // Two passes: thumbnails often fill in a moment after the first render.
    thumb.dataset.roliSerialPass = marked.length ? '2' : String(Number(thumb.dataset.roliSerialPass || 0) + 1);
  }

  // Roblox's "Limited" / "Limited U" tag is pinned to the bottom-left of the thumbnail,
  // right where the value row sits. Depending on the page it is a sprite span, an image
  // or a plain text label, so find it by class name, alt/title/aria-label, or its text.
  // Move it to the top-left (below the serial chip if there is one). Runs on every render
  // because Roblox can rebuild the tag.
  function liftLimitedTags(card, thumb, footer) {
    const LIMITED_TEXT = /^limited(?:\s*u(?:nique)?)?$/i;
    const tr = thumb.getBoundingClientRect();
    const fr = footer.getBoundingClientRect();
    const marked = [];
    // Some versions draw the tag as a ::before / ::after pseudo-element with text content.
    for (const el of [thumb, card, ...thumb.querySelectorAll('*')]) {
      if (el.closest('.roli-value-footer')) continue;
      for (const which of ['before', 'after']) {
        const content = getComputedStyle(el, '::' + which).content;
        if (content && content !== 'none' && content !== 'normal' && /limited/i.test(content)) el.classList.add('roli-pl-' + which);
      }
    }
    for (const el of card.querySelectorAll('*')) {
      if (el === footer || footer.contains(el) || el.closest('.roli-value-footer') || el.closest('.roli-serial')) continue;
      if (/^(SCRIPT|STYLE|SVG|PATH|BUTTON|INPUT)$/i.test(el.tagName)) continue;
      if (marked.some(m => m.contains(el))) continue;

      const cls = String(el.getAttribute('class') || '');
      const label = el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('aria-label') || '';
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const byName = /limited/i.test(cls) || /limited/i.test(label);
      const byText = el.children.length <= 2 && LIMITED_TEXT.test(txt);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.width > 120 || r.height > 40) continue;
      // Last resort, independent of naming: any small non-image element that is sitting
      // underneath our value row (and is not part of it) is Roblox's tag.
      const byGeometry = !byName && !byText && el.classList.contains('roli-limited-tag') === false &&
        r.width >= 8 && r.height >= 8 && el.tagName !== 'IMG' && !el.querySelector('img') &&
        fr.width > 0 && intersects(r, fr) && r.top > tr.top + tr.height * 0.5 && r.left < tr.left + tr.width * 0.6;
      if (!byName && !byText && !byGeometry) continue;
      // Never grab the item picture or anything holding it.
      if (el.tagName === 'IMG' ? r.width > 80 : [...el.querySelectorAll('img')].some(i => i.getBoundingClientRect().width > 60)) continue;
      // A text match must actually sit on the thumbnail, near the bottom.
      if (!byName && tr.height >= 40 && r.top < tr.top + tr.height * 0.4) continue;

      el.classList.add('roli-limited-tag');
      marked.push(el);
    }
    const hasSerial = !!card.querySelector('.roli-serial');
    marked.forEach(el => el.classList.toggle('roli-limited-low', hasSerial));
  }

  function intersects(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 2 && h > 2;
  }

  function footerOverlapsNeighbours(card, footer) {
    const fr = footer.getBoundingClientRect();
    if (fr.width < 1 || fr.height < 1) return false;
    const seenEls = new Set();
    // Compare against the card's siblings and its ancestors' siblings (grid cells / rows).
    let node = card;
    for (let depth = 0; depth < 4 && node?.parentElement; depth++, node = node.parentElement) {
      for (const sib of node.parentElement.children) {
        if (sib === node || seenEls.has(sib)) continue;
        seenEls.add(sib);
        if (sib.matches?.('script, style') ) continue;
        const sr = sib.getBoundingClientRect();
        if (sr.width < 1 || sr.height < 1) continue;
        if (intersects(fr, sr)) return true;
      }
    }
    // Footer must also stay within the card's own box.
    const cr = card.getBoundingClientRect();
    return fr.bottom > cr.bottom + 2;
  }

  function enterOverlayMode(card, footer) {
    footer.dataset.roliMode = 'overlay';
    footer.classList.add('roli-footer-overlay');
    const sub = footer.querySelector('.roli-sub'); if (sub) sub.remove();
    const img = card.querySelector('img');
    const thumb = card.querySelector('.item-card-thumb-container, [class*="thumb"]') || img?.parentElement || card;
    if (getComputedStyle(thumb).position === 'static') thumb.style.setProperty('position', 'relative', 'important');
    thumb.appendChild(footer);
  }

  const overlapTimers = new WeakMap();
  function scheduleOverlapCheck(card, footer) {
    if (overlapTimers.has(footer)) return;
    const run = () => {
      if (!footer.isConnected || footer.dataset.roliMode === 'overlay') return;
      if (footerOverlapsNeighbours(card, footer)) enterOverlayMode(card, footer);
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
    overlapTimers.set(footer, setTimeout(() => { run(); setTimeout(run, 1200); }, 500));
  }

  function buildSub(info) {
    const sub = document.createElement('div');
    sub.className = 'roli-sub';
    const rap = document.createElement('span'); rap.className = 'roli-sub-rap';
    const dem = document.createElement('span'); dem.className = 'roli-sub-demand';
    sub.append(rap, dem);
    fillSub(sub, info);
    return sub;
  }

  function fillSub(sub, info) {
    sub.querySelector('.roli-sub-rap').textContent = `RAP ${fmt(info.rap)}`;
    const demand = info.demand && info.demand !== 'None' ? info.demand : '';
    sub.querySelector('.roli-sub-demand').textContent = demand ? `${demand} demand` : '';
  }

  function addInlineValue(card, id) {
    const info = getItemInfo(id);
    if (!info) return { value: 0, rap: 0 };

    const context = classifyCard(card);
    const composerCard = context === "offer";

    // The value badge is pinned inside the item's thumbnail with absolute
    // positioning, so it never changes any card/grid/offer-slot height and
    // therefore can never overlap or be covered by another row.
    const img = card.querySelector('img');
    const CAPTION_SEL = '.item-card-caption, .item-card-name, [class*="item-card-name"], [class*="item-name"]';
    // Thumbnail = highest ancestor of the image that does NOT contain the item
    // name/caption, so the badge can never sit over the text below the picture.
    let thumb = card;
    if (img) {
      thumb = img.parentElement || card;
      while (thumb.parentElement && thumb.parentElement !== card && !thumb.parentElement.querySelector(CAPTION_SEL)) thumb = thumb.parentElement;
      if (thumb.querySelector(CAPTION_SEL)) thumb = img.parentElement || card;
    }
    // A zero-size / inline thumbnail box would hide the badge entirely; use the card instead.
    { const tr = thumb.getBoundingClientRect(); if (thumb !== card && (tr.height < 40 || tr.width < 40)) thumb = card; }
    let footer = card.querySelector('.roli-value-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'roli-value-footer';
    }
    footer.classList.toggle('roli-footer-overlay', !composerCard);
    footer.classList.toggle('roli-footer-inline', composerCard);
    footer.dataset.roliMode = composerCard ? 'inline' : 'overlay';

    if (composerCard) {
      // Offer slots are small horizontal rows (thumbnail on the left, text on
      // the right). Put the values in the text column, in normal flow, below
      // the name/price, instead of covering anything.
      let nameEl = nameElHint.get(card);
      if (!nameEl || !card.contains(nameEl)) nameEl = card.querySelector(CAPTION_SEL);
      let target = null, after = null;
      if (nameEl && img && !nameEl.contains(img)) {
        let col = nameEl;
        while (col.parentElement && col.parentElement !== card && !col.parentElement.contains(img)) col = col.parentElement;
        if (col !== nameEl) target = col; else after = nameEl;
      } else if (nameEl) {
        after = nameEl;
      }
      if (target) { if (footer.parentElement !== target || footer.nextElementSibling) target.appendChild(footer); }
      else if (after) { if (footer.previousElementSibling !== after) after.insertAdjacentElement('afterend', footer); }
      else if (footer.parentElement !== card) card.appendChild(footer);
      growSlot(card);
    } else {
      if (footer.parentElement !== thumb) {
        if (getComputedStyle(thumb).position === 'static') thumb.style.setProperty('position', 'relative', 'important');
        thumb.appendChild(footer);
      }
      footer.classList.toggle('roli-top', thumb === card);
      if (thumb !== card) {
        liftSerials(thumb, footer);
        liftLimitedTags(card, thumb, footer);
        setTimeout(() => { liftSerials(thumb, footer); liftLimitedTags(card, thumb, footer); }, 600);
        setTimeout(() => liftLimitedTags(card, thumb, footer), 1800);
      }
      footer.classList.toggle('roli-compact', (thumb.getBoundingClientRect().width || 999) < 90);
    }
    footer.dataset.roliContext = context;
    footer.classList.toggle('roli-has-usd', !!routilityEnabled);
    const wrapper = card;

    const hasSet = hasPositiveSetValue(rawItem(id));
    let row = footer.querySelector?.(`.${VALUE_CLASS}[data-item-id="${CSS.escape(String(id))}"]`);
    if (!row) {
      footer.querySelectorAll(`.${VALUE_CLASS}`).forEach(el => el.remove());
      row = document.createElement('div');
      row.className = VALUE_CLASS;
      row.dataset.itemId = String(id);
      const main = document.createElement('div'); main.className = 'roli-main';
      const label = document.createElement('span'); label.className = 'roli-label';
      const number = document.createElement('span'); number.className = 'roli-number';
      main.append(label, number); row.append(main);
      footer.prepend(row);
    }
    const projNoValue = info.projected === "Yes" && !hasSet;
    row.dataset.valueSource = hasSet ? 'Value' : 'RAP';
    row.dataset.roliContext = context;
    row.querySelector('.roli-label').textContent = hasSet ? 'Value' : (info.fromRoblox ? 'RBX RAP' : projNoValue ? 'PROJ' : 'RAP');
    row.querySelector('.roli-number').textContent = fmt(info.value);
    row.classList.toggle('roli-projected', info.projected === "Yes");
    row.title = info.fromRoblox ? "Rolimon's has no value for this item, so this is Roblox's own RAP." : info.projected === "Yes" ? "Projected item: its RAP may be inflated." : "";

    // Extra detail line only in inventory-style views where there is room.
    let sub = row.querySelector('.roli-sub');
    if (false) {
      if (!sub) row.append(buildSub(info));
      else fillSub(sub, info);
    } else if (sub) {
      sub.remove();
    }

    const existing = footer.querySelector('.roli-routility-value');
    if (routilityEnabled) {
      if (!existing) {
        const rrow = document.createElement('div');
        rrow.className = 'roli-routility-value';
        rrow.dataset.itemId = String(id);
        const rlabel = document.createElement('span');
        rlabel.className = 'roli-routility-label';
        rlabel.textContent = routilityCfg.label || 'USD'; rlabel.title = 'RoUtility value';
        const rnumber = document.createElement('span');
        rnumber.className = 'roli-routility-number';
        rnumber.textContent = 'Loading…';
        rrow.append(rlabel, rnumber);
        footer.appendChild(rrow);
        getRoutilityValue(id).then(v => {
          if (!rrow.isConnected) return;
          rnumber.textContent = v == null ? 'N/A' : formatRoutility(v);
        });
      }
    } else if (existing) {
      existing.remove();
    }

    let statsBtn = footer.querySelector('.roli-stats-btn');
    if (!statsBtn) {
      statsBtn = document.createElement('button');
      statsBtn.type = 'button';
      statsBtn.className = 'roli-stats-btn';
      statsBtn.textContent = 'Stats';
      statsBtn.title = 'Show item stats';
      statsBtn.setAttribute('aria-label', 'Show item stats');
      statsBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); showPopup(statsBtn.dataset.itemId); });
    }
    statsBtn.dataset.itemId = String(id);
    let btnRow = footer.querySelector('.roli-btn-row');
    if (!btnRow) { btnRow = document.createElement('div'); btnRow.className = 'roli-btn-row'; }
    if (statsBtn.parentElement !== btnRow) btnRow.prepend(statsBtn);
    if (footer.lastElementChild !== btnRow) footer.appendChild(btnRow);

    let graphBtn = btnRow.querySelector('.roli-graph-btn');
    if (graphEnabled) {
      if (!graphBtn) {
        graphBtn = document.createElement('button');
        graphBtn.type = 'button';
        graphBtn.className = 'roli-stats-btn roli-graph-btn';
        graphBtn.textContent = 'Graph';
        graphBtn.title = "Show Rolimon's graph";
        graphBtn.setAttribute('aria-label', "Show Rolimon's graph");
        graphBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); showGraph(graphBtn.dataset.itemId); });
      }
      graphBtn.dataset.itemId = String(id);
      if (graphBtn.parentElement !== btnRow) btnRow.appendChild(graphBtn);
    } else if (graphBtn) {
      graphBtn.remove();
    }

    row.title = `RAP ${fmt(info.rap)} · ${info.demand && info.demand !== 'None' ? info.demand + ' demand' : 'No demand data'} (use the Stats button for details)`;

    return { value: info.value, rap: info.rap };
  }

  function offerContainerForTotal(totalRow) {
    let el = totalRow?.parentElement;
    for (let i = 0; i < 14 && el; i++, el = el.parentElement) {
      const totalChildren = [...el.querySelectorAll("div.robux-line")]
        .filter(row => !row.classList.contains(TOTAL_CLASS) && /Total Value:/.test((row.textContent || "").replace(/\s+/g, " ").trim()));
      const valueRows = el.querySelectorAll(`.${VALUE_CLASS}[data-item-id]:not([data-roli-context="inventory"])`).length;
      if (totalChildren.length === 1 && valueRows > 0) return el;
    }
    return totalRow?.parentElement || totalRow;
  }

  function visibleOfferItems(totalRow, container) {
    const totalRect = rect(totalRow);
    if (!totalRect) return [];

    const notInventory = (el) => el.dataset.roliContext !== 'inventory';
    const direct = [...(container?.querySelectorAll?.(`.${VALUE_CLASS}[data-item-id]`) || [])]
      .filter(notInventory)
      .map(el => ({ el, r: rect(el) }))
      .filter(x => x.r && x.r.bottom <= totalRect.top + 12 && x.r.top < totalRect.top);
    if (direct.length) return direct.map(x => x.el);

    // Fallback for Roblox's dynamic cards: find rendered item-value rows near the
    // same offer column. This avoids depending on a particular card class.
    const all = [...document.querySelectorAll(`.${VALUE_CLASS}[data-item-id]`)]
      .filter(notInventory)
      .map(el => ({ el, r: rect(el) }))
      .filter(x => x.r && x.r.bottom <= totalRect.top + 12 && x.r.top < totalRect.top);
    const sameColumn = all.filter(x => {
      const overlap = Math.max(0, Math.min(x.r.right, totalRect.right) - Math.max(x.r.left, totalRect.left));
      const minWidth = Math.max(1, Math.min(x.r.width, totalRect.width));
      const centerDistance = Math.abs((x.r.left + x.r.width / 2) - (totalRect.left + totalRect.width / 2));
      return overlap / minWidth >= 0.25 || centerDistance <= Math.max(80, totalRect.width * 0.6);
    });

    // Prefer the closest vertical group before the total row. Roblox can leave
    // unrelated inventory cards in the same document, so cap the look-back.
    sameColumn.sort((a, b) => b.r.top - a.r.top);
    const picked = [];
    let lastBottom = totalRect.top;
    for (const item of sameColumn) {
      if (picked.length >= 60) break;
      if (lastBottom - item.r.bottom > Math.max(420, totalRect.height * 18) && picked.length) break;
      picked.push(item.el);
      lastBottom = Math.min(lastBottom, item.r.top);
    }
    return picked;
  }

  function renderTotals(root) {
    const totalRows = findTotalRows(root).map((row) => ({ row, r: rect(row) })).filter(x => x.r);
    if (!totalRows.length) return;

    const width = Math.max(document.documentElement.clientWidth, window.innerWidth);
    const rows = totalRows
      .filter(x => x.r.left + x.r.width / 2 >= width * 0.45)
      .sort((a, b) => a.r.top - b.r.top)
      .slice(0, 2);

    let needsRetry = false;
    rows.forEach((entry) => {
      const container = offerContainerForTotal(entry.row);
      const itemRows = visibleOfferItems(entry.row, container);
      // One entry per rendered card. Never dedupe by item id/text: owning several copies of the
      // same item (e.g. 3x Verdant Crown) is three separate cards and each must be counted.
      const items = new Map();
      new Set(itemRows).forEach((el, n) => {
        const id = String(el.dataset.itemId || "");
        const info = id ? getItemInfo(id) : null;
        if (info) items.set(n, info);
      });

      let valueTotal = 0;
      let count = 0;
      for (const info of items.values()) {
        valueTotal += info.value;
        count += 1;
      }

      let row = entry.row.nextElementSibling;
      if (!row?.classList?.contains(TOTAL_CLASS)) row = null;

      if (!count) {
        // Do not delete a valid existing total just because Roblox is temporarily
        // rebuilding the offer cards. Retry after the cards settle.
        if (row) {
          needsRetry = true;
        } else {
          needsRetry = true;
        }
        return;
      }

      if (!row) {
        row = document.createElement("div");
        row.className = TOTAL_CLASS;
        const label = document.createElement("span");
        label.className = "roli-total-label";
        const value = document.createElement("span");
        value.className = "roli-value";
        row.append(label, value);
        entry.row.insertAdjacentElement("afterend", row);
      }

      row.dataset.roliTotalSource = "1";
      row.querySelector(".roli-total-label").textContent = `Rolimon's Value · ${count} item${count === 1 ? "" : "s"}`;
      row.querySelector(".roli-value").textContent = fmt(valueTotal);
    });

    if (needsRetry) {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 250);
    }
  }

  function tradeIdFromHref(href) {
    const m = String(href || "").match(/\/trades\/(\d+)(?:[/?#]|$)/i);
    return m ? m[1] : null;
  }

  async function getAuthenticatedUserId() {
    if (authenticatedUserId) return authenticatedUserId;
    try {
      const r = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials:"include", cache:"no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      authenticatedUserId = j?.id ? String(j.id) : null;
    } catch (_) {}
    return authenticatedUserId;
  }

  function tradeAssetNames(offer) {
    const assets = Array.isArray(offer?.userAssets) ? offer.userAssets : [];
    return assets.map(a => String(a?.name ?? ""));
  }

  function tradeAssetIds(offer) {
    const assets = Array.isArray(offer?.userAssets) ? offer.userAssets : [];
    return assets.map(a => String(a?.assetId ?? a?.asset?.id ?? ""));
  }

  // Requests to Roblox's trades API go one at a time, spaced out, and pause after a 429,
  // so we never compete with Roblox's own trade loading.
  const MAX_PARALLEL = 2;
  const MIN_GAP_MS = 250;          // minimum spacing between request starts
  let _active = 0, _cooldownUntil = 0, _pumpTimer = null, _lastStart = 0, _failStreak = 0;
  // Roblox answers 429 (and sometimes 403) when it is being hit too fast. That is a "slow down",
  // not a verdict on the trade, so back off for longer each time instead of giving up.
  function throttleBackoff() {   // only for real 429s, and kept short so rows never sit on "loading"
    _failStreak = Math.min(_failStreak + 1, 4);
    _cooldownUntil = Math.max(_cooldownUntil, Date.now() + Math.min(20000, 2500 * 2 ** (_failStreak - 1)));
  }
  // Roblox sometimes answers 403 until the request carries its CSRF token (it hands the token back in the
  // 403's x-csrf-token header). Pick it up and retry once instead of treating the trade as broken.
  let _csrf = null;
  async function tradesGet(url) {
    let r;
    for (let i = 0; i < 2; i++) {
      r = await fetch(url, { credentials: "include", cache: "no-store", headers: _csrf ? { "X-CSRF-TOKEN": _csrf } : undefined });
      if (r.status === 403) {
        const t = r.headers.get("x-csrf-token");
        if (t && t !== _csrf) { _csrf = t; continue; }
      }
      break;
    }
    return r;
  }
  const _queue = [];
  function pump() {
    clearTimeout(_pumpTimer);
    const wait = _cooldownUntil - Date.now();
    if (wait > 0) { _pumpTimer = setTimeout(pump, wait); return; }
    while (_active < MAX_PARALLEL && _queue.length) {
      const gap = _lastStart + MIN_GAP_MS - Date.now();
      if (gap > 0) { _pumpTimer = setTimeout(pump, gap); return; }
      const job = _queue.shift();
      _lastStart = Date.now();
      _active++;
      Promise.resolve().then(job.fn).then(job.res, job.rej).finally(() => { _active--; pump(); });
    }
  }
  function limited(fn) {
    return new Promise((res, rej) => { _queue.push({ fn, res, rej }); pump(); });
  }

  // Trade offers never change once created, so remember them across page loads (per account).
  const PERSIST_KEY = "rolimonsTradeDataCache";
  let persisted = {}, persistLoaded = null, persistTimer = null;
  function loadPersisted() {
    if (!persistLoaded) persistLoaded = browser.storage.local.get(PERSIST_KEY).then(r => { persisted = r?.[PERSIST_KEY] || {}; }).catch(() => {});
    return persistLoaded;
  }
  function savePersisted() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const keys = Object.keys(persisted);
      if (keys.length > 400) keys.sort((x, y) => (persisted[x].at || 0) - (persisted[y].at || 0)).slice(0, keys.length - 400).forEach(k => delete persisted[k]);
      browser.storage.local.set({ [PERSIST_KEY]: persisted }).catch(() => {});
    }, 1500);
  }

  const tradeDataCache = new Map();

  // Raw offer data never changes for a given trade, so cache that. Values are recomputed
  // from the latest Rolimon's data every time so the Win/Loss call never goes stale.
  // Turn an HTTP failure into the right kind of error: temporary ones are retried, never shown as "unavailable".
  function tradeHttpError(id, r) {
    if (r.status === 429) throttleBackoff();
    const transient = [429, 401, 403, 400, 408, 409, 425].includes(r.status) || r.status >= 500;
    const e = new Error(transient ? `HTTP ${r.status} (temporary, retrying)` : `trade ${id}: HTTP ${r.status}`);
    e.status = r.status;
    if (transient) e.transient = true; else e.permanent = r.status >= 400 && r.status < 500;
    return e;
  }

  const num0 = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

  // Every plausible asset id on a trade item, best guess first. Faces and other newer items don't always
  // carry the id in the usual field, so we collect several and pick the one Rolimon's knows later.
  function itemIdCandidates(it) {
    const out = [];
    const push = v => { const t = String(v ?? ""); if (/^\d{1,16}$/.test(t) && !out.includes(t)) out.push(t); };
    push(it?.assetId); push(it?.itemTarget?.targetId); push(it?.targetId); push(it?.asset?.id); push(it?.itemId); push(it?.item?.assetId);
    const scan = (o, depth) => {
      if (!o || typeof o !== "object" || depth > 3) return;
      for (const [k, v] of Object.entries(o)) {
        if (/instance|userasset|serial|collectible|price|stock|robux|hold/i.test(k)) continue;
        if (v && typeof v === "object") scan(v, depth + 1);
        else if (/id$/i.test(k) && !(depth === 0 && k === "id")) push(v);   // top-level "id" is the owned copy, not the item
      }
    };
    scan(it, 0);
    return out;
  }

  // v1: Roblox's original trade details. Returns null when the trade has no readable offers.
  async function fetchTradeV1(id, me) {
    const r = await limited(() => tradesGet(`https://trades.roblox.com/v1/trades/${encodeURIComponent(id)}`));
    if (!r.ok) throw tradeHttpError(id, r);
    _failStreak = 0;
    const trade = await r.json();
    const offers = Array.isArray(trade?.offers) ? trade.offers : [];
    if (offers.length < 2) return null;
    const mine = offers.find(o => String(o?.user?.id) === String(me));
    const theirs = offers.find(o => o !== mine);
    if (!mine || !theirs) { const e = new Error(`trade ${id}: could not tell which offer is yours`); e.transient = true; throw e; }
    const list = o => Array.isArray(o?.userAssets) ? o.userAssets : [];
    const raps = o => list(o).map(a => num0(a?.recentAveragePrice));
    const cands = o => list(o).map(itemIdCandidates);
    return {
      mineIds: tradeAssetIds(mine), theirIds: tradeAssetIds(theirs), mineCands: cands(mine), theirCands: cands(theirs),
      mineNames: tradeAssetNames(mine), theirNames: tradeAssetNames(theirs),
      mineRaps: raps(mine), theirRaps: raps(theirs),
      mineRobux: Number(mine?.robux) || 0, theirRobux: Number(theirs?.robux) || 0
    };
  }

  // v2: the newer endpoint. It describes items differently (itemTarget / itemName / recentAveragePrice) and is the
  // one that still works for trades v1 can't describe, such as ones containing faces or other newer items.
  async function fetchTradeV2(id, me) {
    const r = await limited(() => tradesGet(`https://trades.roblox.com/v2/trades/${encodeURIComponent(id)}`));
    if (!r.ok) throw tradeHttpError(id, r);
    const t = await r.json();
    const A = t?.participantAOffer, B = t?.participantBOffer;
    if (!A || !B) return null;
    const mine = String(A?.user?.id) === String(me) ? A : String(B?.user?.id) === String(me) ? B : null;
    const theirs = mine ? (mine === A ? B : A) : null;
    if (!mine || !theirs) { const e = new Error(`trade ${id}: could not tell which offer is yours`); e.transient = true; throw e; }
    const items = o => Array.isArray(o?.items) ? o.items : [];
    const idOf = it => {
      const tgt = it?.itemTarget || {};
      const type = tgt.itemType;
      const isAsset = type == null || type === 1 || type === "1" || String(type).toLowerCase() === "asset";
      const v = isAsset ? (tgt.targetId ?? it?.assetId ?? "") : "";
      return /^\d+$/.test(String(v)) ? String(v) : (itemIdCandidates(it)[0] || "");
    };
    const cands = o => items(o).map(itemIdCandidates);
    return {
      mineIds: items(mine).map(idOf), theirIds: items(theirs).map(idOf), mineCands: cands(mine), theirCands: cands(theirs),
      mineNames: items(mine).map(it => String(it?.itemName ?? it?.name ?? "")), theirNames: items(theirs).map(it => String(it?.itemName ?? it?.name ?? "")),
      mineRaps: items(mine).map(it => num0(it?.recentAveragePrice)), theirRaps: items(theirs).map(it => num0(it?.recentAveragePrice)),
      mineRobux: Number(mine?.robux) || 0, theirRobux: Number(theirs?.robux) || 0
    };
  }

  async function getTradeData(id) {
    if (tradeDataCache.has(id)) return tradeDataCache.get(id);
    const promise = (async () => {
      await loadPersisted();
      const me = await getAuthenticatedUserId();
      if (!me) throw new Error("could not determine your user id");
      const pkey = `${me}:${id}`;
      if (persisted[pkey]?.d?.mineCands) return persisted[pkey].d;   // older cache entries lack names/RAPs: refetch
      let data = null, err = null;
      try { data = await fetchTradeV1(id, me); } catch (e) { err = e; }
      const incomplete = d => d && [...(d.mineCands || []), ...(d.theirCands || [])].some(c => !c.length);
      if (!data || incomplete(data)) {
        // v1 failed or left items out (faces and other newer items): ask the newer endpoint.
        try { const d2 = await fetchTradeV2(id, me); if (d2 && (!incomplete(d2) || !data)) data = d2; err = data ? null : err; }
        catch (e2) { if (!data) err = (err && err.transient) ? err : (e2.transient ? e2 : err || e2); }
      }
      if (!data && err) throw err;
      if (!data) return null;
      persisted[pkey] = { d: data, at: Date.now() };
      savePersisted();
      return data;
    })();
    tradeDataCache.set(id, promise);
    try { return await promise; } catch (e) { tradeDataCache.delete(id); throw e; }
  }

  // Pick the id Rolimon's knows; failing that, a unique exact name; failing that, the first candidate.
  function resolveAssetId(cands, name, fallbackId) {
    const list = cands?.length ? cands : (fallbackId ? [fallbackId] : []);
    for (const c of list) if (rawItem(c)) return c;
    const nk = normName(name);
    if (nk) { const hit = getNameIndex()?.get(nk); if (hit) return hit; }
    return list[0] || "";
  }

  // `raps` = Roblox's own RAP for each item, taken from the trade itself. It is the last resort, so a face
  // Rolimon's can't match is still counted instead of making the whole trade "no value".
  function sumSide(ids, names, raps) {
    let sum = 0, projected = 0, projValue = 0;
    const unknown = [];
    ids.forEach((assetId, i) => {
      let info = assetId ? getItemInfo(assetId) : null;
      if ((!info || !(info.value > 0)) && raps?.[i] > 0) info = { value: raps[i], projected: "None", hasSet: false, fromRoblox: true, name: names?.[i] };
      if (!info || !(info.value > 0)) { unknown.push(`${names?.[i] || info?.name || "Item"} (id ${assetId || "none"})`); return; }
      sum += info.value;
      if (info.projected === "Yes") { projected++; if (!info.hasSet) projValue += info.value; }   // projected with no set Value: RAP can be inflated
    });
    return { sum, projected, projValue, unknown };
  }

  async function getTradeInfo(id) {
    const d0 = await getTradeData(id);
    if (!d0) return null;
    // Work out which Rolimon's item each trade item is.
    const mineIds = d0.mineIds.map((x, i) => resolveAssetId(d0.mineCands?.[i], d0.mineNames?.[i], x));
    const theirIds = d0.theirIds.map((x, i) => resolveAssetId(d0.theirCands?.[i], d0.theirNames?.[i], x));
    const d = { ...d0, mineIds, theirIds };
    [[d.mineIds, d.mineRaps], [d.theirIds, d.theirRaps]].forEach(([ids, raps]) => ids.forEach((aid, i) => {
      if (aid && needsFallback(aid) && raps?.[i] > 0 && !(liveRapCache.get(String(aid)) > 0)) liveRapCache.set(String(aid), raps[i]);
    }));
    await Promise.all([...d.mineIds, ...d.theirIds].filter(x => x && needsFallback(x)).map(liveRapFor));
    const mineSide = sumSide(d.mineIds, d.mineNames, d.mineRaps), theirSide = sumSide(d.theirIds, d.theirNames, d.theirRaps);
    // Robux you give counts in full; Robux you receive is worth 70% after Roblox's 30% tax.
    const mineValue = mineSide.sum + d.mineRobux;
    const theirsValue = theirSide.sum + Math.floor(d.theirRobux * 0.7);
    const delta = theirsValue - mineValue;
    const pct = mineValue > 0 ? (delta / mineValue) * 100 : null;
    // Worst / best case if projected items (inflated RAP, no set Value) turn out to be worth nothing.
    const deltaMin = (theirsValue - theirSide.projValue) - mineValue;
    const deltaMax = theirsValue - (mineValue - mineSide.projValue);
    const itemsOf = (ids, names, raps) => ids.map((x, i) => {
      const inf = x ? getItemInfo(x) : null;
      const value = inf?.value > 0 ? inf.value : (raps?.[i] || 0);
      return { id: x, name: (inf && !inf.fromRoblox && inf.name) || names?.[i] || inf?.name || `Item ${x}`, acronym: inf?.acronym || "", value };
    });
    return {
      mineValue, theirsValue, delta, pct, deltaMin, deltaMax,
      mineItems: itemsOf(d.mineIds, d.mineNames, d.mineRaps), theirItems: itemsOf(d.theirIds, d.theirNames, d.theirRaps),
      mineRobux: d.mineRobux, theirRobux: d.theirRobux,
      unknown: [...mineSide.unknown, ...theirSide.unknown],
      projectedReceiving: theirSide.projected, projectedGiving: mineSide.projected
    };
  }

  function closestTradeContainer(anchor) {
    let el = anchor;
    for (let i=0; i<6 && el; i++, el=el.parentElement) {
      const tradeLinks = el.querySelectorAll?.('a[href*="/trades/"]')?.length || 0;
      if (tradeLinks === 1 && (el.offsetHeight >= 35 || el.offsetWidth >= 250)) return el;
    }
    return anchor.parentElement || anchor;
  }

  const readoutPending = new WeakSet();
  const readoutFailAt = new Map();
  async function addTradeReadout(anchor, id) {
    // Check the DOM, not a flag: Roblox can re-render and drop our badge while keeping the link.
    const host0 = closestTradeContainer(anchor);
    if (host0.querySelector(`.roli-trade-readout[data-trade-id="${id}"]`) || readoutPending.has(anchor)) return;
    if (Date.now() - (readoutFailAt.get(id) || 0) < 10000) return;
    readoutPending.add(anchor);
    try {
      const info = await getTradeInfo(id);
      if (!info || !winLossEnabled || !anchor.isConnected) return;
      const host = closestTradeContainer(anchor);
      if (host.querySelector(`.roli-trade-readout[data-trade-id="${id}"]`)) return;
      const el = document.createElement("span");
      const d = describeTrade(info);
      el.className = "roli-trade-readout " + (d.kind === "win" ? "roli-trade-win" : d.kind === "loss" ? "roli-trade-loss" : "roli-trade-even");
      el.dataset.tradeId = id;
      el.title = d.title;
      el.textContent = d.kind === "win" ? `WIN +${fmt(info.delta)}` : d.kind === "loss" ? `LOSS ${fmt(info.delta)}` : d.label.replace(/^\? /, "? ").replace("EVEN", "EVEN");
      anchor.insertAdjacentElement("afterend", el);
    } catch (_) { readoutFailAt.set(id, Date.now()); }
    finally { readoutPending.delete(anchor); }
  }

  function clearWinLoss() {
    document.querySelectorAll(".roli-row-win, .roli-row-loss, .roli-row-even, .roli-row-unk").forEach(el => clearRowIndicator(el));
    document.querySelectorAll(".roli-trade-readout").forEach(el => el.remove());
    document.querySelectorAll("[data-roli-trade-readout]").forEach(el => { delete el.dataset.roliTradeReadout; });
  }

  const rowState = new WeakMap();   // row -> what it should currently show
  const rowGuard = new WeakMap();   // row -> MutationObserver that restores it
  let rowMemo = new WeakMap();      // row -> trade it was last matched to
  // Trades Roblox really won't give details for (e.g. 404). id -> when we last saw that.
  const retryAt = new Map(), failCount = new Map();   // per-trade retry delay after a temporary failure
  const unavailableIds = new Map();
  const markUnavailable = (id, yes) => { if (yes) unavailableIds.set(String(id), Date.now()); else unavailableIds.delete(String(id)); };

  function clearRowIndicator(row) {
    rowState.delete(row);
    rowGuard.get(row)?.disconnect();
    rowGuard.delete(row);
    row.classList.remove("roli-row-win", "roli-row-loss", "roli-row-even", "roli-row-unk", "roli-rel");
    if (row.hasAttribute("data-roli-id")) row.removeAttribute("title");   // only our own tooltip
    row.removeAttribute("data-roli-label");
    row.removeAttribute("data-roli-id");
  }

  function applyRowIndicator(row, st) {
    row.classList.remove("roli-row-win", "roli-row-loss", "roli-row-even", "roli-row-unk");
    if (getComputedStyle(row).position === "static") row.classList.add("roli-rel");
    row.classList.add(`roli-row-${st.kind}`);
    row.setAttribute("data-roli-id", st.id);
    row.setAttribute("data-roli-label", st.label);
    row.setAttribute("title", st.title);
  }

  function rowIsPainted(row) {
    const st = rowState.get(row);
    return !!st && row.classList.contains(`roli-row-${st.kind}`) && row.getAttribute("data-roli-label") === st.label;
  }

  // Roblox re-renders rows (e.g. after you click a trade) and can strip our class/attributes
  // without adding or removing nodes. Put the badge back right away when that happens.
  function guardRow(row) {
    if (rowGuard.has(row)) return;
    let hits = [];
    const mo = new MutationObserver(() => {
      const st = rowState.get(row);
      if (!st || !winLossEnabled || rowIsPainted(row)) return;
      const now = Date.now();
      hits = hits.filter(t => now - t < 3000);
      if (hits.length >= 6) return;   // something keeps fighting us; the periodic check will handle it
      hits.push(now);
      applyRowIndicator(row, st);
    });
    mo.observe(row, { attributes: true, attributeFilter: ["class", "data-roli-label"] });
    rowGuard.set(row, mo);
  }

  function setRowIndicator(row, id, kind, label, title) {
    const st = { id, kind, label, title };
    rowState.set(row, st);
    guardRow(row);
    if (row.dataset.roliId === id && rowIsPainted(row) && row.getAttribute("title") === title) return;
    applyRowIndicator(row, st);
  }

  // true when the result depends on a projected item's (possibly inflated) RAP
  function tradeUncertain(info) {
    return (info.delta > 0 && info.deltaMin <= 0) || (info.delta < 0 && info.deltaMax >= 0);
  }

  function describeTrade(info) {
    if (!info) return { kind: "unk", label: "? NO DATA", title: "Roblox returned no offer data for this trade" };
    let kind, label;
    let title = `You give ${fmt(info.mineValue)} / you get ${fmt(info.theirsValue)}`;
    if (info.unknown.length) {
      // Never call a win/loss when an item has no value: it would be a guess.
      kind = "unk";
      label = "? NO VALUE";
      title = `Can't call this trade: no value for ${[...new Set(info.unknown)].join(", ")}. Known items only: you give ${fmt(info.mineValue)} / you get ${fmt(info.theirsValue)}`;
    } else if (tradeUncertain(info)) {
      kind = "unk";
      label = "? PROJECTED";
      title = `Can't call this trade: it includes projected item(s) with no set Value, so their RAP may be inflated. ` +
        `Counted at RAP it is ${info.delta > 0 ? "+" : ""}${fmt(info.delta)}, but it could be anywhere from ${fmt(info.deltaMin)} to ${fmt(info.deltaMax)}.`;
    } else {
      kind = info.delta > 0 ? "win" : info.delta < 0 ? "loss" : "even";
      const pct = info.pct == null || kind === "even" ? "" : ` (${info.pct > 0 ? "+" : ""}${info.pct.toFixed(1)}%)`;
      label = kind === "win" ? `WIN +${fmt(info.delta)}${pct}` : kind === "loss" ? `LOSS ${fmt(info.delta)}${pct}` : "EVEN";
    }
    return { kind, label, title };
  }

  function showRowResult(row, id, info) {
    if (!row.isConnected || !winLossEnabled) return;
    const d = describeTrade(info);
    setRowIndicator(row, id, d.kind, d.label, d.title);
  }

  // Load every trade first (retrying failures) so all rows can be painted together.
  async function loadTradeInfos(ids, onProgress) {
    const results = new Map();
    let done = 0;
    for (let pass = 0; pass < 3; pass++) {
      const todo = ids.filter(id => !results.has(id));
      if (!todo.length) break;
      await Promise.all(todo.map(async id => {
        try {
          const info = await getTradeInfo(id);
          results.set(id, { info });
          markUnavailable(id, !info);
          onProgress?.(++done, ids.length);
        } catch (e) {
          if (e?.permanent && !e.transient) { results.set(id, { error: e }); markUnavailable(id, true); onProgress?.(++done, ids.length); }
        }
      }));
      if (ids.some(id => !results.has(id)) && pass < 2) await new Promise(r => setTimeout(r, 2500));
    }
    return results;
  }

  function findTradeAnchors(root) {
    return [...root.querySelectorAll('a[href*="/trades/"]')].filter(a => tradeIdFromHref(a.getAttribute("href") || a.href));
  }

  function ensureBulkToolbar(root) {
    if (!/^\/trades\/outbound(?:\/|$)/i.test(location.pathname)) return;
    if (root.querySelector(".roli-bulk-toolbar")) return;
    const anchors = findTradeAnchors(root);
    if (!anchors.length) return;
    const toolbar = document.createElement("div");
    toolbar.className = "roli-bulk-toolbar";
    toolbar.innerHTML = `<button type="button" data-roli-select> Select all </button><button type="button" data-roli-cancel disabled>Cancel selected</button><span data-roli-count>0 selected</span>`;
    const first = closestTradeContainer(anchors[0]);
    first.parentElement?.insertBefore(toolbar, first);
    const cancel = toolbar.querySelector("[data-roli-cancel]");
    const count = toolbar.querySelector("[data-roli-count]");
    const boxes = () => findTradeAnchors(root).map(a => ({a, id:tradeIdFromHref(a.getAttribute("href") || a.href), box:a.parentElement?.querySelector?.(".roli-trade-select")}));
    const update = () => { const n=boxes().filter(x=>x.box?.checked).length; count.textContent=`${n} selected`; cancel.disabled=!n; };
    toolbar.querySelector("[data-roli-select]").addEventListener("click", () => { boxes().forEach(x=>{if(x.box)x.box.checked=true}); update(); });
    cancel.addEventListener("click", async () => {
      const selected = boxes().filter(x=>x.box?.checked).map(x=>x.id).filter(Boolean);
      if (!selected.length) return;
      if (!confirm(`Cancel ${selected.length} outbound trade${selected.length === 1 ? "" : "s"}?`)) return;
      cancel.disabled=true; status(`Cancelling ${selected.length} trade${selected.length===1?"":"s"}…`);
      let ok=0;
      let csrfToken = null;
      for (const id of selected) {
        try {
          const headers = {"Content-Type":"application/json"};
          if (csrfToken) headers["X-CSRF-TOKEN"] = csrfToken;
          let r = await fetch(`https://trades.roblox.com/v1/trades/${encodeURIComponent(id)}/cancel`, {method:"POST", credentials:"include", headers});
          if (r.status === 403) {
            const token = r.headers.get("x-csrf-token");
            if (token) {
              csrfToken = token;
              headers["X-CSRF-TOKEN"] = csrfToken;
              r = await fetch(`https://trades.roblox.com/v1/trades/${encodeURIComponent(id)}/cancel`, {method:"POST", credentials:"include", headers});
            }
          }
          if (r.ok) ok++;
        } catch (_) {}
      }
      status(`${ok} trade${ok===1?"":"s"} cancelled.`, false);
      setTimeout(()=>location.reload(), 500);
    });
    findTradeAnchors(root).forEach(a => {
      const host=closestTradeContainer(a); if(host.querySelector(".roli-trade-select")) return;
      const box=document.createElement("input"); box.type="checkbox"; box.className="roli-trade-select"; box.title="Select trade"; box.addEventListener("change",update); a.insertAdjacentElement("beforebegin",box);
    });
    update();
  }

  let rowsBusy = false;
  const tradeListCache = new Map();

  function newTradeList() {
    return { at: Date.now(), trades: [], cursor: null, done: false, pages: 0, failed: false, refreshing: false, busy: Promise.resolve() };
  }

  function fillTradeList(type, c, need) {
    c.busy = c.busy.then(async () => {
      c.failed = false;
      while (!c.done && c.trades.length < need && c.pages < 20) {
        const url = `https://trades.roblox.com/v1/trades/${type}?sortOrder=Desc&limit=25` + (c.cursor ? `&cursor=${encodeURIComponent(c.cursor)}` : "");
        const r = await limited(() => tradesGet(url));
        if (r.status === 429) throttleBackoff();
        if ([429, 401, 403].includes(r.status)) { c.failed = true; break; }
        if (!r.ok) { c.failed = true; break; }
        const j = await r.json();
        c.trades.push(...(Array.isArray(j?.data) ? j.data : []));
        c.cursor = j?.nextPageCursor || null;
        c.pages++;
        if (!c.cursor) c.done = true;
      }
    }).catch(() => { c.failed = true; });
    return c.busy;
  }

  function getTradeList(type, need) {
    let c = tradeListCache.get(type);
    if (!c) {
      c = newTradeList();
      tradeListCache.set(type, c);
    } else if (Date.now() - c.at > 30000 && !c.refreshing) {
      // Refresh in the background, but keep using the old list until the new one is ready.
      // (Before, an expired list was thrown away immediately; if the refetch hit a rate limit the
      // list came back empty and every Win/Loss badge got wiped.)
      c.refreshing = true;
      const fresh = newTradeList();
      fillTradeList(type, fresh, Math.max(need, c.trades.length)).then(() => {
        if (!fresh.failed || (fresh.trades.length > 0 && fresh.trades.length >= c.trades.length)) tradeListCache.set(type, fresh);
        else { c.at = Date.now() - 100000; c.refreshing = false; }   // try again in ~20s
      });
    }
    return fillTradeList(type, c, need).then(() => c.trades);
  }

  const TAB_WORDS = { inbound: "inbound", received: "inbound", outbound: "outbound", sent: "outbound",
                      completed: "completed", inactive: "inactive", closed: "inactive" };
  const TAB_RE = /inbound|received|outbound|sent|completed|inactive|closed/;

  function detectTradeType() {
    // 1) a tab that is explicitly marked active
    const sel = '.rbx-tab.active, .rbx-tab-heading.active, [role="tab"][aria-selected="true"], [aria-current="page"], [aria-current="true"], [aria-pressed="true"], .tab-active, li.active, a.active, button.active, .active > a';
    for (const el of document.querySelectorAll(sel)) {
      const t = (el.textContent || "").trim().toLowerCase();
      if (t.length > 40) continue;
      const m = t.match(TAB_RE);
      if (m) return TAB_WORDS[m[0]];
    }
    // 2) tab pills with no active marker (the current Roblox layout): the one that looks different is the active one
    const cands = [...document.querySelectorAll("button, a, [role='tab'], li, div, span")].filter(el =>
      el.childElementCount <= 1 && TAB_WORDS[(el.textContent || "").trim().toLowerCase()] &&
      !el.closest(OURS_SELECTOR) && el.offsetHeight > 0 && el.offsetHeight < 90);
    const groups = new Map();
    cands.forEach(el => { const k = el.parentElement; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(el); });
    for (const els of groups.values()) {
      if (new Set(els.map(e => TAB_WORDS[e.textContent.trim().toLowerCase()])).size < 3) continue;
      const marked = els.find(e => /active|selected|current|checked|\bon\b/i.test(e.className || "") || e.getAttribute("aria-selected") === "true");
      if (marked) return TAB_WORDS[marked.textContent.trim().toLowerCase()];
      const styleKey = e => { const c = getComputedStyle(e); return `${c.backgroundColor}|${c.color}|${c.fontWeight}`; };
      const counts = new Map();
      els.forEach(e => counts.set(styleKey(e), (counts.get(styleKey(e)) || 0) + 1));
      const odd = els.filter(e => counts.get(styleKey(e)) === 1);
      if (odd.length === 1) return TAB_WORDS[odd[0].textContent.trim().toLowerCase()];
    }
    const m = (location.pathname + location.hash).toLowerCase().match(TAB_RE);
    return m ? TAB_WORDS[m[0]] : null;
  }

  // Last resort when the tab can't be read: the trade list whose users line up with the rows on screen.
  async function inferTradeType(rows, offset) {
    let best = null, bestN = 0;
    for (const t of ["inbound", "outbound", "completed", "inactive"]) {
      const list = await getTradeList(t, offset + rows.length + 5);
      const n = rows.filter((row, i) => list[offset + i] && rowMatches(row, list[offset + i])).length;
      if (n > bestN) { best = t; bestN = n; }
    }
    return bestN >= Math.max(1, Math.ceil(rows.length / 2)) ? best : null;
  }

  function guessTradeType() {
    // Roblox opens on Inbound by default.
    return "inbound";
  }

  function findTradeRows() {
    const sel = 'li.trade-row, .trade-row, [class*="trade-row"], [class*="tradeRow"], [class*="trade-list-item"], [class*="trades-list"] > li, [class*="trade-list"] > li';
    let c = [...document.querySelectorAll(sel)].filter(el =>
      !el.closest(OURS_SELECTOR) &&
      (el.classList.contains("roli-filtered-out") || (el.offsetHeight > 20 && el.offsetHeight <= 300)) &&   // a row, not a big container
      (el.textContent || "").trim().length > 0 && (el.textContent || "").length < 800 &&
      !el.querySelector('[class*="item-card"], a[href*="/catalog/"], a[href*="/marketplace/asset/"]'));
    c = c.filter(el => !c.some(o => o !== el && o.contains(el)));     // outermost row only
    return c;
  }

  function rowMatches(row, trade) {
    const text = (row.textContent || "").toLowerCase();
    return [trade?.user?.displayName, trade?.user?.name].some(n => n && text.includes(String(n).toLowerCase()));
  }

  // Roblox shows ~10 trades per page; work out which page we're on so rows line up with the right trades.
  function detectPageOffset() {
    const cands = document.querySelectorAll('.pager-cur input, .pager .pager-cur, [class*="pager"] input[type="number"], [class*="pager"] input[type="text"], [class*="pagination"] .active, [class*="pager"] .active');
    for (const el of cands) {
      const n = parseInt(el.value || el.textContent || "", 10);
      if (Number.isFinite(n) && n >= 1 && n < 1000) return (n - 1) * 10;
    }
    return 0;
  }

  const scriptStart = Date.now();
  let rowsDirty = false, unmatchedRetries = 0, lastFailAt = 0, lastDetectedType = null;
  async function renderTradeRows() {
    if (!winLossEnabled && !filterActive()) return;
    if (rowsBusy) { rowsDirty = true; return; }
    const sinceStart = Date.now() - scriptStart;
    if (sinceStart < 2500) { scheduleRender(2500 - sinceStart); return; }
    rowsBusy = true;
    let problems = 0;
    try {
      const rows = findTradeRows();
      if (!rows.length) return;
      // If the tab can't be read right now (e.g. a trade popup is open), reuse the last known tab.
      let detectedNow = detectTradeType();
      const offset = detectPageOffset();
      if (!detectedNow) detectedNow = await inferTradeType(rows, offset);
      if (detectedNow) lastDetectedType = detectedNow;
      const detected = detectedNow || lastDetectedType;
      const need = offset + rows.length + 5;
      const types = detected ? [detected] : ["inbound", "outbound", "completed", "inactive"];
      const pool = [];
      let poolComplete = true;
      for (const t of types) {
        (await getTradeList(t, need)).forEach(tr => pool.push(tr));
        const c = tradeListCache.get(t);
        if (!c || (!c.done && c.trades.length < need)) poolComplete = false;
      }

      const used = new Set();
      const assigned = new Map();   // row -> trade
      // Pass 1: name-confirmed matches. Prefer the trade at this row's own position on this page.
      rows.forEach((row, i) => {
        let tr = null;
        const cand = detected ? pool[offset + i] : null;
        if (cand && !used.has(cand.id) && rowMatches(row, cand)) tr = cand;
        else {
          // Only accept a name match when it is the ONLY candidate. If the same person has several
          // trades, guessing could put another trade's Win/Loss on this row, so wait for a better match.
          const window = detected ? pool.slice(offset, offset + rows.length + 5) : pool;
          let c1 = window.filter(x => !used.has(x.id) && rowMatches(row, x));
          if (c1.length === 0) c1 = pool.filter(x => !used.has(x.id) && rowMatches(row, x));
          tr = c1.length === 1 ? c1[0] : null;
        }
        if (tr) { used.add(tr.id); assigned.set(row, tr); }
      });
      // Pass 1b: keep a row's previous trade if the list couldn't be loaded this time.
      rows.forEach(row => {
        if (assigned.has(row)) return;
        const m = rowMemo.get(row);
        // Only trust the memory if the trade is still in the list (it may have been accepted/declined),
        // or the list simply couldn't be loaded right now.
        const stillThere = !poolComplete || pool.some(x => String(x.id) === String(m?.id));
        if (m && stillThere && !used.has(m.id) && rowMatches(row, m)) { used.add(m.id); assigned.set(row, m); }
      });
      // Pass 2: names that couldn't be read fall back to list order.
      if (detected) {
        rows.forEach((row, i) => {
          if (assigned.has(row)) return;
          const cand = pool[offset + i];
          if (cand && !used.has(cand.id)) { used.add(cand.id); assigned.set(row, cand); }
        });
      }
      rows.forEach(row => { if (!assigned.has(row)) problems++; });
      assigned.forEach((tr, row) => {
        const painted = row.getAttribute("data-roli-id");
        if (painted && painted !== String(tr.id)) clearRowIndicator(row);   // row now shows a different trade
        rowMemo.set(row, tr);
      });
      lastAssigned = assigned;
      if (!detectedNow) {
        // Tab label unreadable: the list that contains these rows' trades tells us which tab it is.
        let best = null, bestN = 0;
        for (const [t, c] of tradeListCache) {
          const ids = new Set(c.trades.map(x => String(x.id)));
          const n = [...assigned.values()].filter(x => ids.has(String(x.id))).length;
          if (n > bestN) { best = t; bestN = n; }
        }
        if (best) lastDetectedType = best;
      }
      if (filterActive()) { applyRowFilter(); runFilter(); }

      // Each row loads and paints independently, so one slow or failing trade never holds the rest up.
      assigned.forEach((tr, row) => { if (!rowIsPainted(row)) setRowIndicator(row, String(tr.id), "unk", "LOADING…", "Loading trade value…"); });
      await Promise.all([...assigned].map(async ([row, tr]) => {
        const id = String(tr.id);
        if ((retryAt.get(id) || 0) > Date.now()) { problems++; return; }   // waiting out a retry delay
        try {
          const info = await getTradeInfo(id);
          retryAt.delete(id); failCount.delete(id); markUnavailable(id, !info);
          if (row.isConnected) showRowResult(row, id, info); else problems++;
        } catch (e) {
          if (!row.isConnected) { problems++; return; }
          if (e?.permanent && !e.transient) {
            markUnavailable(id, true);
            setRowIndicator(row, id, "unk", "? UNAVAILABLE", `Roblox wouldn't give the offer details for this trade (${e.message}). Checking again in a minute.`);
          } else {
            const n = (failCount.get(id) || 0) + 1;
            failCount.set(id, n);
            retryAt.set(id, Date.now() + Math.min(45000, 2000 * 2 ** n));
            setRowIndicator(row, id, "unk", "RETRYING…", `Roblox didn't answer yet (${e?.message || "error"}). Retrying automatically.`);
            problems++; lastFailAt = Date.now();
          }
        }
      }));
      // Only remove a badge from an unmatched row when we have the whole trade list and
      // still can't match it. An incomplete/failed list must never wipe good badges.
      if (poolComplete) rows.forEach(row => { if (!assigned.has(row) && row.hasAttribute("data-roli-label")) clearRowIndicator(row); });
    } catch (e) {
      console.debug("[Rolimon's] trade rows failed", e);
      problems++;
    } finally {
      rowsBusy = false;
      if (problems && unmatchedRetries++ < 8) scheduleRender(2500);
      else if (!problems) unmatchedRetries = 0;
      if (rowsDirty) { rowsDirty = false; scheduleRender(300); }
    }
  }


  // ---- Trade filter (trades page) ----
  // Works on Roblox's own trade list: rows that don't match are hidden, the rest stay fully usable
  // (open / accept / counter / decline). If the current page has no matches it moves to the next
  // page that does.
  const FILTER_THRESHOLD = 0.02;   // within 2% of each other counts as "Equal"
  const FILTER_MAX = 300;          // newest trades checked
  const PAGE_SIZE = 10;            // Roblox shows ~10 trades per page
  let tradeFilterEnabled = true;
  const fstate = { mode: "all", quality: "none", query: "", type: null, token: 0, running: false, done: false,
                   infos: new Map(), pending: new Set(), hideUnavailable: false, order: [], lastOffset: null, dir: 1, navAt: 0, navCount: 0 };
  let filterBarEl = null, lastAssigned = new Map();

  function filterActive() {
    return fstate.hideUnavailable || fstate.quality !== "none" || (fstate.mode !== "all" && !(fstate.mode === "search" && !fstate.query.trim()));
  }

  function bestValue(items) { return items.reduce((m, i) => Math.max(m, i.value || 0), 0); }

  // Quality tags a trade fits, from YOUR point of view.
  function classifyTrade(info) {
    const tags = new Set();
    if (info.mineRobux > 0 || info.theirRobux > 0) tags.add("robux");
    if (info.unknown.length) return { tags, valued: false };
    const big = Math.max(info.mineValue, info.theirsValue);
    if (big > 0 && Math.abs(info.delta) <= big * FILTER_THRESHOLD) tags.add("equal");
    else if (info.delta > 0) tags.add("overpay");    // you get more than you give
    else if (info.delta < 0) tags.add("underpay");   // you give more than you get
    const nm = info.mineItems.length, nt = info.theirItems.length;
    const bm = bestValue(info.mineItems), bt = bestValue(info.theirItems);
    if (nt > 0 && nt < nm && bt > bm) tags.add("upgrade");     // fewer items, higher top item
    if (nm > 0 && nt > nm && bm > bt) tags.add("downgrade");   // more items, lower top item
    return { tags, valued: true };
  }

  function itemMatches(items, q) {
    return items.some(i => i.name.toLowerCase().includes(q) || (i.acronym && i.acronym.toLowerCase() === q));
  }

  function tradePasses(info) {
    if (!info) return true;   // nothing known about it: never hide it
    const sure = !info.unknown.length && !tradeUncertain(info);
    if (fstate.quality === "win" && !(info.delta > 0 && sure)) return false;
    if (fstate.quality === "loss" && !(info.delta < 0 && sure)) return false;
    const m = fstate.mode;
    if (m === "search") {
      const q = fstate.query.trim().toLowerCase();
      return !q || itemMatches(info.mineItems, q) || itemMatches(info.theirItems, q);
    }
    if (m !== "all") return classifyTrade(info).tags.has(m);
    return true;
  }

  function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function currentFilterType() {
    const t = detectTradeType();
    if (t) lastDetectedType = t;
    return t || lastDetectedType || guessTradeType();
  }

  function clearRowFilter() {
    document.querySelectorAll(".roli-filtered-out").forEach(el => el.classList.remove("roli-filtered-out"));
  }

  function pagerButton(dir) {
    const re = dir > 0 ? /next|forward|›|»|>/i : /prev|back|‹|«|</i;
    const pools = document.querySelectorAll('[class*="pager"], [class*="pagination"], [class*="Pager"], [class*="Pagination"]');
    for (const pool of pools) {
      for (const el of pool.querySelectorAll('button, a, [role="button"], li, span')) {
        const label = `${el.getAttribute("aria-label") || ""} ${el.title || ""} ${el.className || ""} ${(el.textContent || "").trim().length <= 8 ? el.textContent : ""}`;
        if (!re.test(label)) continue;
        if (el.matches('[disabled], [aria-disabled="true"], .disabled') || /disabled/i.test(el.className || "")) continue;
        return el;
      }
    }
    return null;
  }

  // Hide non-matching rows on the current page; if none match, go to the nearest page that has a match.
  function applyRowFilter() {
    if (!tradeFilterEnabled) return;
    if (!filterActive()) { clearRowFilter(); return; }
    const rows = findTradeRows();
    if (!rows.length) return;
    let visible = 0, unassigned = 0;
    rows.forEach(row => {
      const tr = lastAssigned.get(row) || rowMemo.get(row);
      let info = tr ? fstate.infos.get(String(tr.id)) : null;
      if (tr && info === undefined) {
        // Not analysed yet (e.g. a different tab than the one being scanned): load just this trade now.
        const key = String(tr.id);
        if (!fstate.pending.has(key)) {
          fstate.pending.add(key);
          getTradeInfo(key).then(i => { fstate.infos.set(key, i); markUnavailable(key, !i); })
            .catch(e => { if (e?.permanent && !e.transient) { fstate.infos.set(key, null); markUnavailable(key, true); } })
            .finally(() => { fstate.pending.delete(key); applyRowFilter(); });
        }
        info = null; unassigned++;   // leave the row alone until we know
      }
      if (!tr) unassigned++;
      const gone = !!tr && fstate.hideUnavailable && (unavailableIds.has(String(tr.id)) || info === null);
      const pass = !tr || (!gone && tradePasses(info));
      row.classList.toggle("roli-filtered-out", !pass);
      if (pass) visible++;
    });
    const offset = detectPageOffset();
    if (fstate.lastOffset != null && offset !== fstate.lastOffset) fstate.dir = offset > fstate.lastOffset ? 1 : -1;
    fstate.lastOffset = offset;
    if (visible > 0 || unassigned > 0) { fstate.navCount = 0; return; }

    // Nothing left on this page: find the nearest page with a match (needs the analysis to have reached it).
    const pages = new Set();
    fstate.order.forEach((id, i) => {
      if (fstate.hideUnavailable && (unavailableIds.has(id) || fstate.infos.get(id) === null)) return;
      if (fstate.infos.has(id) && tradePasses(fstate.infos.get(id))) pages.add(Math.floor(i / PAGE_SIZE));
    });
    const cur = Math.floor(offset / PAGE_SIZE);
    const sorted = [...pages].sort((a, b) => a - b);
    const next = sorted.find(p => p > cur), prev = [...sorted].reverse().find(p => p < cur);
    const dir = fstate.dir > 0 ? (next != null ? 1 : prev != null ? -1 : 0) : (prev != null ? -1 : next != null ? 1 : 0);
    if (!dir || fstate.navCount >= 40) return;
    const again = () => { clearTimeout(fstate.navTimer); fstate.navTimer = setTimeout(applyRowFilter, 700); };
    if (Date.now() - fstate.navAt < 600) { again(); return; }
    const btn = pagerButton(dir);
    if (!btn) return;
    fstate.navAt = Date.now(); fstate.navCount++;
    btn.click();
    again();   // keep going if the new page has no matches either
  }

  async function runFilter() {
    if (!tradeFilterEnabled || !filterActive() || !itemData) return;
    const token = ++fstate.token;
    const type = currentFilterType();
    if (fstate.type !== type) { fstate.type = type; fstate.order = []; fstate.done = false; }
    if (fstate.running) return;
    fstate.running = true;
    try {
      const list = await getTradeList(type, FILTER_MAX);
      fstate.order = list.slice(0, FILTER_MAX).map(t => String(t.id));
      for (let pass = 0; pass < 2; pass++) {
        const todo = fstate.order.filter(id => !fstate.infos.has(id));
        for (let i = 0; i < todo.length; i += 6) {
          if (fstate.type !== type) return;
          await Promise.all(todo.slice(i, i + 6).map(async id => {
            try { const inf = await getTradeInfo(id); fstate.infos.set(id, inf); markUnavailable(id, !inf); }
            catch (e) { if (e?.permanent && !e.transient) { fstate.infos.set(id, null); markUnavailable(id, true); } }
          }));
          applyRowFilter();
        }
        if (fstate.order.every(id => fstate.infos.has(id))) break;
        await new Promise(r => setTimeout(r, 2500));
      }
    } catch (e) { console.debug("[Rolimon's] filter failed", e); }
    finally {
      fstate.running = false;
      if (fstate.type !== currentFilterType()) runFilter();   // tab changed meanwhile
      else applyRowFilter();
    }
  }

  function applyFilterState() {
    fstate.navCount = 0;
    if (!filterActive()) { clearRowFilter(); return; }
    applyRowFilter();
    runFilter();
  }

  function ensureFilterBar() {
    if (!tradeFilterEnabled || !/^\/trades(?:\/|$)/i.test(location.pathname)) return;
    if (filterBarEl?.isConnected) {
      if (filterActive()) {
        if (fstate.type !== currentFilterType() && !fstate.running) runFilter();   // switched Inbound/Outbound/…
        applyRowFilter();
      }
      return;
    }
    const first = findTradeRows()[0];
    const list = first?.parentElement;
    if (!list || !list.parentElement) return;
    const bar = mk("div", "roli-filter-bar");
    const field = (label, ctl) => { const l = mk("label", "", label); l.appendChild(ctl); return l; };
    const sel = (opts, val, onChange) => {
      const s = document.createElement("select");
      opts.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); });
      s.value = val; s.addEventListener("change", () => onChange(s.value)); return s;
    };
    const query = document.createElement("input");
    query.type = "search"; query.placeholder = "Item name or acronym"; query.value = fstate.query; query.autocomplete = "off";
    query.style.display = fstate.mode === "search" ? "" : "none";
    let qt; query.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { fstate.query = query.value; applyFilterState(); }, 250); });
    const quality = sel([["none", "None"], ["win", "Wins"], ["loss", "Losses"]], fstate.quality, v => { fstate.quality = v; applyFilterState(); });
    const mode = sel([
      ["all", "All trades"], ["equal", "Equal"], ["overpay", "Overpay"], ["underpay", "Underpay"],
      ["upgrade", "Upgrade"], ["downgrade", "Downgrade"], ["robux", "Robux"], ["search", "Item search"]
    ], fstate.mode, v => {
      fstate.mode = v;
      query.style.display = v === "search" ? "" : "none";
      if (v === "search") query.focus();
      applyFilterState();
    });
    bar.append(field("Trade quality filter", quality), field("Sort by", mode), query);
    list.parentElement.insertBefore(bar, list);
    filterBarEl = bar;
    if (filterActive()) applyFilterState();
  }

  function removeFilterBar() {
    clearRowFilter();
    filterBarEl?.remove();
    filterBarEl = null;
    fstate.token++;
  }

  function renderTradeReadouts(root) {
    if (!/^\/trades(?:\/|$)/i.test(location.pathname)) return;
    if (winLossEnabled) findTradeAnchors(root).forEach(a => addTradeReadout(a, tradeIdFromHref(a.getAttribute("href") || a.href)));
    ensureBulkToolbar(root);
    ensureFilterBar();
    if (winLossEnabled) renderTradeRows();
  }

  function render() {
    if (rendering || !itemData || !pageAllowed()) return;
    rendering = true;

    try {
      const root = findRoot();

      // Roblox frequently replaces trade cards without a full page navigation.
      // Use every catalog item link as the source of truth. This catches dynamic heads/faces
      // even when Roblox gives them a different card class than ordinary limiteds.
      getItemHosts(document.body).forEach((card) => {
        const id = getExplicitCardId(card) || hostIdHint.get(card) || getItemIdFromCard(card);
        if (id) addInlineValue(card, id);
      });

      renderTotals(findRoot());
      renderTradeReadouts(root);
      status("", true);
    } finally {
      rendering = false;
    }
  }

  function scheduleRender(delay = 150) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay);
  }

  async function loadValues() {
    try {
      const setting = await browser.storage.local.get(["routilityEnabled", "routilityStatsEnabled", "tradeWinLossEnabled", "profileValuesEnabled", "graphButtonEnabled", "tradeFilterEnabled"]);
      tradeFilterEnabled = setting.tradeFilterEnabled !== false;
      routilityEnabled = !!setting.routilityEnabled;
      routilityStatsEnabled = !!setting.routilityStatsEnabled;
      winLossEnabled = setting.tradeWinLossEnabled !== false;
      profileValuesEnabled = !!setting.profileValuesEnabled;
      graphEnabled = !!setting.graphButtonEnabled;
      if (!pageAllowed()) { status("", true); return; }
      status("Loading Rolimon's values…");
      const result = await browser.runtime.sendMessage({ type: "getRolimonsItems" });
      if (!result?.ok || !result.items) {
        throw new Error(result?.error || "No item data returned");
      }

      itemData = { items: result.items };
      render();
    } catch (err) {
      console.error("[Rolimon's]", err);
      status("Rolimon's values could not be loaded. Check the extension permissions.");
    }
  }

  if (!IS_TRADE_PAGE && !IS_PROFILE_PAGE) return;

  ensureStyle();
  loadColors();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.rolimonsColors) {
      colors = { ...DEFAULT_COLORS, ...(changes.rolimonsColors.newValue || {}) };
      applyColorVariables();
    }
    if (changes.tradeWinLossEnabled) {
      winLossEnabled = changes.tradeWinLossEnabled.newValue !== false;
      if (winLossEnabled) scheduleRender(50); else clearWinLoss();
    }
    if (changes.tradeFilterEnabled) {
      tradeFilterEnabled = changes.tradeFilterEnabled.newValue !== false;
      if (tradeFilterEnabled) scheduleRender(50); else removeFilterBar();
    }
    if (changes.graphButtonEnabled) {
      graphEnabled = !!changes.graphButtonEnabled.newValue;
      if (!graphEnabled) document.querySelectorAll(".roli-graph-btn").forEach(el => el.remove());
      else scheduleRender(50);
    }
    if (changes.profileValuesEnabled) {
      profileValuesEnabled = !!changes.profileValuesEnabled.newValue;
      if (profileValuesEnabled) { if (itemData) scheduleRender(50); else loadValues(); }
      else clearValues();
    }
    if (changes.routilityStatsEnabled) {
      routilityStatsEnabled = !!changes.routilityStatsEnabled.newValue;
    }
    if (changes.routilityEnabled) {
      routilityEnabled = !!changes.routilityEnabled.newValue;
      routilityCache.clear();
      scheduleRender(50);
    }
    if (changes.routilitySettings) {
      routilityCfg = { ...ROUTILITY_DEFAULTS, ...(changes.routilitySettings.newValue || {}) };
      applyColorVariables();
      applyRoutilityLabels();
      // re-format numbers already on screen
      document.querySelectorAll(".roli-routility-value").forEach(r => r.remove());
      scheduleRender(50);
    }
  });

  // Roblox is a SPA. Watch for trade cards being added/replaced.
  const observer = new MutationObserver((mutations) => {
    const isOurs = (n) => {
      const el = n.nodeType === 1 ? n : n.parentElement;
      return !!el?.closest?.(`.${VALUE_CLASS}, .${TOTAL_CLASS}, .roli-value-footer, .roli-trade-readout, .roli-bulk-toolbar, .roli-filter-bar, .roli-filter-results, #${POPUP_ID}, #${STATUS_ID}`) ||
        (n.nodeType === 1 && n.classList?.contains("roli-inventory-item-wrap"));
    };
    const relevant = mutations.some((m) => {
      if (m.type === "characterData") return !isOurs(m.target);
      const nodes = [...m.addedNodes, ...m.removedNodes];
      return nodes.length && nodes.some(n => !isOurs(n)) ;
    });
    if (relevant) scheduleRender();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  window.addEventListener("load", () => scheduleRender(0));
  window.addEventListener("popstate", () => scheduleRender(300));
  window.addEventListener("hashchange", () => scheduleRender(300));

  loadValues();
  if (/^\/trades(?:\/|$)/i.test(location.pathname)) {
    // Warm everything up in parallel with Rolimon's values: stored trade data, your user id, and the trade lists.
    loadPersisted();
    getAuthenticatedUserId();
    ["inbound", "outbound", "completed", "inactive"].forEach(t => getTradeList(t, 25));
  }

  // Roblox can re-render rows and wipe our labels without adding/removing nodes.
  // A row needs repainting if it has no badge, a placeholder badge, or its badge class was stripped.
  const rowNeedsPaint = (r) => {
    const l = r.getAttribute("data-roli-label");
    if (l === "? UNAVAILABLE") {   // never leave a trade stuck as unavailable: look again every minute
      const id = r.getAttribute("data-roli-id");
      if (Date.now() - (unavailableIds.get(String(id)) || 0) > 60000) return true;
    }
    return !l || l === "LOADING…" || l === "RETRYING…" || !rowIsPainted(r);
  };
  function recheckRows() {
    if (document.hidden || (!winLossEnabled && !filterActive()) || !itemData || !/^\/trades(?:\/|$)/i.test(location.pathname)) return;
    if (!winLossEnabled || findTradeRows().some(rowNeedsPaint)) renderTradeRows();
  }
  setInterval(() => {
    if (Date.now() - lastFailAt < 8000) return;
    recheckRows();
  }, 3000);
  // Clicking a trade / closing its popup makes Roblox rebuild the list: check again right after.
  document.addEventListener("click", (e) => {
    // After Accept / Decline / Counter / Cancel the list changes: drop the old list so no row keeps another trade's badge.
    const b = e.target?.closest?.("button, a, [role=\"button\"]");
    if (b && /^(accept|decline|counter|cancel|send)\b/i.test((b.textContent || "").trim())) {
      setTimeout(() => { tradeListCache.clear(); rowMemo = new WeakMap(); document.querySelectorAll("[data-roli-label]").forEach(clearRowIndicator); fstate.order = []; scheduleRender(200); }, 1500);
    }
    [300, 1000, 2500].forEach(ms => setTimeout(recheckRows, ms));
  }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) recheckRows(); });

  // Re-pull Rolimon's values every 2 minutes so Win/Loss reflects current values.
  setInterval(async () => {
    try {
      const result = await browser.runtime.sendMessage({ type: "getRolimonsItems" });
      if (result?.ok && result.items && !document.hidden) { itemData = { items: result.items }; renderTradeRows(); }
    } catch (_) {}
  }, 2 * 60 * 1000);
})();
