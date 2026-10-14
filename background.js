const API_URL = "https://api.rolimons.com/items/v2/itemdetails";
const CACHE_KEY = "rolimonsItemDetails";
const CACHE_TTL = 60 * 1000;
const NOTIFY_SETTINGS_KEY = "rolimonsTradeNotifications";
const ALARM_NAME = "rolimons-trade-check";

const TRADE_TYPES = {
  inbound: {
    seenKey: "rolimonsSeenInboundTrades",
    initKey: "rolimonsInboundInitialized",
    path: "inbound",
    title: "New Roblox inbound trade",
    message: "You received a new inbound trade."
  },
  declined: {
    seenKey: "rolimonsSeenDeclinedTrades",
    initKey: "rolimonsDeclinedInitialized",
    path: "declined",
    title: "Roblox trade declined",
    message: "A Roblox trade was declined."
  },
  completed: {
    seenKey: "rolimonsSeenCompletedTrades",
    initKey: "rolimonsCompletedInitialized",
    path: "completed",
    title: "Roblox trade completed",
    message: "A Roblox trade was completed."
  }
};

let memoryCache = null;
let memoryFetchedAt = 0;
let inFlight = null;

async function fetchItems() {
  if (memoryCache && Date.now() - memoryFetchedAt < CACHE_TTL) return memoryCache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let response = await fetch(API_URL, { cache: "no-store" });
    if (!response.ok) response = await fetch("https://api.rolimons.com/items/v1/itemdetails", { cache: "no-store" });
    if (!response.ok) throw new Error(`Rolimon's API returned HTTP ${response.status}`);
    const json = await response.json();
    if (!json || typeof json.items !== "object") throw new Error("Rolimon's API returned an invalid item table");
    memoryCache = json.items;
    memoryFetchedAt = Date.now();
    await browser.storage.local.set({ [CACHE_KEY]: { fetchedAt: memoryFetchedAt, items: memoryCache } });
    return memoryCache;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

async function getItems() {
  if (memoryCache) return memoryCache;
  try {
    const stored = await browser.storage.local.get(CACHE_KEY);
    const cached = stored[CACHE_KEY];
    if (cached?.items && cached?.fetchedAt && Date.now() - cached.fetchedAt < CACHE_TTL) {
      memoryCache = cached.items;
      memoryFetchedAt = cached.fetchedAt;
      return memoryCache;
    }
  } catch (e) { console.warn("[Rolimon's] cache read failed", e); }
  return fetchItems();
}

const ROUTILITY_CACHE_KEY = "routilityValueCache_v2"; // v2: old cache held values from the inaccurate parser
const ROUTILITY_CACHE_TTL = 5 * 60 * 1000;

function toRoutilityNumber(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Walk any JSON-LD structure looking for offers.price (exact, to the cent).
function findOfferPrice(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const x of node) { const p = findOfferPrice(x); if (p != null) return p; }
    return null;
  }
  const offers = node.offers;
  if (offers) {
    for (const o of (Array.isArray(offers) ? offers : [offers])) {
      const cur = String(o?.priceCurrency || "USD").toUpperCase();
      const p = toRoutilityNumber(o?.price);
      if (p != null && cur === "USD") return p;
    }
  }
  for (const k of Object.keys(node)) {
    if (k === "offers") continue;
    const p = findOfferPrice(node[k]);
    if (p != null) return p;
  }
  return null;
}

function parseRoutilityValue(html) {
  if (typeof html !== "string" || !html) return null;

  // 1) Most accurate: the page's JSON-LD "offers.price" (e.g. 84.80).
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const p = findOfferPrice(JSON.parse(m[1].trim()));
      if (p != null) return p;
    } catch (_) {}
  }

  // 2) Plain-text JSON blob containing "offers":{"price":"84.80"...}
  const offer = /"offers"\s*:\s*\{[^{}]*?"price"\s*:\s*"?([0-9][0-9,]*(?:\.[0-9]+)?)"?/i.exec(html);
  if (offer) { const p = toRoutilityNumber(offer[1]); if (p != null) return p; }

  // 3) Visible "USD Value: $783" line (rounded to whole dollars, but still the
  //    right field). Only this labelled field is used -- never an arbitrary "$".
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
  const label = /USD\s*Value\s*[:\-·|]?\s*\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i.exec(text);
  if (label) return toRoutilityNumber(label[1]);

  return null;
}

// Pulls every stat RoUtility lists on an item page:
// USD Value, RAP, Value, Copies, Demand, Trend.
function parseRoutilityStats(html) {
  if (typeof html !== "string" || !html) return null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\*\*/g, " ")
    .replace(/\s+/g, " ");

  const labels = [
    ["usd", /USD\s*Value/i],
    ["rap", /\bRAP\b/i],
    ["value", /\bValue\b/i],
    ["copies", /\bCopies\b/i],
    ["demand", /\bDemand\b/i],
    ["trend", /\bTrend\b/i]
  ];
  const raw = {};
  let pos = 0;
  const hits = [];
  for (const [key, re] of labels) {
    const m = re.exec(text.slice(pos));
    if (!m) { hits.push(null); continue; }
    const start = pos + m.index, end = start + m[0].length;
    hits.push({ key, start, end });
    pos = end;
  }
  const found = hits.filter(Boolean);
  if (!found.length || found[0].key !== "usd") return null;
  found.forEach((h, i) => {
    const next = found[i + 1];
    let seg = text.slice(h.end, next ? next.start : h.end + 40);
    if (!next) seg = seg.split(/Top limiteds/i)[0];
    raw[h.key] = seg.replace(/^\s*[:\-·|]\s*/, "").trim();
  });

  const num = (v) => {
    if (v == null) return null;
    const m = /([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(v);
    return m ? toRoutilityNumber(m[1]) : null;
  };
  const word = (v) => {
    const m = v && /^([A-Za-z]+)/.exec(v.trim());
    return m ? m[1] : null;
  };

  const stats = {
    usd: num(raw.usd),
    rap: num(raw.rap),
    value: num(raw.value),
    copies: num(raw.copies),
    demand: word(raw.demand),
    trend: word(raw.trend)
  };

  // Exact-to-the-cent USD from the page's structured data when available.
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const p = findOfferPrice(JSON.parse(m[1].trim()));
      if (p != null) { stats.usd = p; break; }
    } catch (_) {}
  }
  return Object.values(stats).some(v => v != null) ? stats : null;
}

const ROUTILITY_STATS_CACHE_KEY = "routilityStatsCache_v1";

async function fetchRoutilityStats(id) {
  const key = String(id);
  try {
    const stored = await browser.storage.local.get(ROUTILITY_STATS_CACHE_KEY);
    const cached = stored[ROUTILITY_STATS_CACHE_KEY]?.[key];
    if (cached && Date.now() - cached.at < ROUTILITY_CACHE_TTL) return cached.stats;
  } catch (_) {}

  const response = await fetch(`https://routility.io/catalog/${encodeURIComponent(key)}`, {
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) throw new Error(`RoUtility HTTP ${response.status}`);
  const stats = parseRoutilityStats(await response.text());
  if (!stats) return null;

  try {
    const stored = await browser.storage.local.get(ROUTILITY_STATS_CACHE_KEY);
    const cache = stored[ROUTILITY_STATS_CACHE_KEY] || {};
    cache[key] = { stats, at: Date.now() };
    await browser.storage.local.set({ [ROUTILITY_STATS_CACHE_KEY]: cache });
  } catch (_) {}
  return stats;
}

async function fetchRoutilityValue(id) {
  const key = String(id);
  try {
    const stored = await browser.storage.local.get(ROUTILITY_CACHE_KEY);
    const cached = stored[ROUTILITY_CACHE_KEY]?.[key];
    if (cached && Date.now() - cached.at < ROUTILITY_CACHE_TTL) return cached.value;
  } catch (_) {}

  const response = await fetch(`https://routility.io/catalog/${encodeURIComponent(key)}`, {
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) throw new Error(`RoUtility HTTP ${response.status}`);
  const html = await response.text();
  const value = parseRoutilityValue(html);
  if (value == null) return null;

  try {
    const stored = await browser.storage.local.get(ROUTILITY_CACHE_KEY);
    const cache = stored[ROUTILITY_CACHE_KEY] || {};
    cache[key] = { value, at: Date.now() };
    await browser.storage.local.set({ [ROUTILITY_CACHE_KEY]: cache });
  } catch (_) {}
  return value;
}

// ---- Rolimon's item history (for the Graph button) ----
const HISTORY_CACHE_TTL = 10 * 60 * 1000;
const historyCache = new Map();

// Pull a JS literal like `var history_data = {...};` out of a page, matching
// brackets while skipping over strings so braces inside text don't confuse it.
function extractJsLiteral(html, name) {
  const m = new RegExp(`(?:(?:var|let|const)\\s+|window\\.)${name}\\s*=\\s*`).exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const open = html[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = null;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      const raw = html.slice(start, i + 1);
      try { return JSON.parse(raw); } catch (_) {}
      try { return JSON.parse(raw.replace(/\bNaN\b|\bundefined\b|\bInfinity\b/g, "null").replace(/,\s*([\]}])/g, "$1")); } catch (_) { return null; }
    }
  }
  return null;
}

// Return a copy of every array reordered oldest -> newest. Arrays whose length
// doesn't match the timestamps are dropped (null) rather than guessed at, so a
// misaligned series can never be drawn against the wrong dates.
function alignByTime(rawT, arrays) {
  const t = rawT.map(Number);
  const order = t.map((_, i) => i).filter(i => Number.isFinite(t[i])).sort((x, y) => t[x] - t[y]);
  const out = { t: order.map(i => t[i]) };
  for (const [k, arr] of Object.entries(arrays)) {
    out[k] = Array.isArray(arr) && arr.length === t.length ? order.map(i => arr[i]) : null;
  }
  return out;
}

// Rolimon's also embeds a sales object (timestamps, average daily sale price,
// sales volume). Key names are matched loosely so a small rename upstream
// doesn't break the graph. Returns { data, info } - `info` explains why sales
// are missing so the popup can say so instead of silently showing nothing.
function parseSalesData(html) {
  let s = null;
  for (const name of ["sales_data", "sale_data", "sales_history", "sales_chart_data"]) {
    s = extractJsLiteral(html, name);
    if (s) break;
  }
  if (!s) return { data: null, info: "none" };
  if (typeof s !== "object" || Array.isArray(s)) return { data: null, info: "unrecognized" };
  const keys = Object.keys(s).filter(k => Array.isArray(s[k]));
  const tKey = keys.find(k => /time|date|day/i.test(k));
  if (!tKey || !s[tKey].length) return { data: null, info: "unrecognized: " + Object.keys(s).join(", ") };
  const pKey = keys.find(k => k !== tKey && /price|avg|average/i.test(k));
  const vKey = keys.find(k => k !== tKey && k !== pKey && /vol|count|qty|quantity|sales|sold/i.test(k));
  if (!pKey && !vKey) return { data: null, info: "unrecognized: " + Object.keys(s).join(", ") };
  const al = alignByTime(s[tKey], { price: pKey ? s[pKey] : null, vol: vKey ? s[vKey] : null });
  const clean = (v, allowZero) => { const n = Number(v); return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : null; };
  const price = al.price ? al.price.map(v => clean(v, false)) : null;
  const vol = al.vol ? al.vol.map(v => clean(v, true)) : null;
  if (!price && !vol) return { data: null, info: "misaligned" };
  return { data: { t: al.t, price, vol }, info: "ok" };
}

async function fetchRolimonsHistory(id) {
  const key = String(id);
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_CACHE_TTL) return hit.data;

  const response = await fetch(`https://www.rolimons.com/item/${encodeURIComponent(key)}`, {
    cache: "no-store",
    credentials: "omit"
  });
  if (!response.ok) throw new Error(`Rolimon's item page HTTP ${response.status}`);
  const html = await response.text();
  const h = extractJsLiteral(html, "history_data");
  if (!h || !Array.isArray(h.timestamp) || !h.timestamp.length) {
    throw new Error("Couldn't find price history on Rolimon's for this item");
  }
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const al = alignByTime(h.timestamp, { rap: h.rap, price: h.best_price });
  if (!al.t.length) throw new Error("Rolimon's returned an empty price history");
  const sales = parseSalesData(html);
  const data = {
    t: al.t,
    rap: al.rap ? al.rap.map(num) : al.t.map(() => null),
    price: al.price ? al.price.map(num) : al.t.map(() => null),
    sales: sales.data,
    salesInfo: sales.info
  };
  historyCache.set(key, { data, at: Date.now() });
  return data;
}

async function getNotificationSettings() {
  const stored = await browser.storage.local.get(NOTIFY_SETTINGS_KEY);
  return {
    inboundEnabled: false,
    declinedEnabled: false,
    completedEnabled: false,
    inboundSound: false,
    ...(stored[NOTIFY_SETTINGS_KEY] || {})
  };
}

async function fetchTradeList(type) {
  const cfg = TRADE_TYPES[type];
  const response = await fetch(
    `https://trades.roblox.com/v1/trades/${cfg.path}?sortOrder=Desc&limit=25`,
    { credentials: "include", cache: "no-store" }
  );
  if (!response.ok) throw new Error(`${cfg.path} trades HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}

async function seedTradeBaseline(type) {
  const cfg = TRADE_TYPES[type];
  try {
    const trades = await fetchTradeList(type);
    const ids = trades.map(t => String(t?.id ?? "")).filter(Boolean);
    await browser.storage.local.set({
      [cfg.seenKey]: ids.slice(-200),
      [cfg.initKey]: true
    });
    return true;
  } catch (e) {
    console.debug(`[Rolimon's] ${type} baseline seed failed`, e);
    return false;
  }
}

async function pollTradeType(type) {
  const cfg = TRADE_TYPES[type];
  try {
    const trades = await fetchTradeList(type);
    const ids = trades.map(t => String(t?.id ?? "")).filter(Boolean);
    if (!ids.length) return;

    const stored = await browser.storage.local.get([cfg.seenKey, cfg.initKey]);
    const seen = new Set(Array.isArray(stored[cfg.seenKey]) ? stored[cfg.seenKey].map(String) : []);

    if (!stored[cfg.initKey]) {
      ids.forEach(id => seen.add(id));
      await browser.storage.local.set({
        [cfg.seenKey]: [...seen].slice(-200),
        [cfg.initKey]: true
      });
      return;
    }

    const fresh = trades
      .filter(t => t?.id != null && !seen.has(String(t.id)))
      .reverse();

    for (const trade of fresh) {
      const id = String(trade.id);
      seen.add(id);
      await browser.notifications.create(`rolimons-${type}-${id}`, {
        type: "basic",
        title: cfg.title,
        message: cfg.message,
        iconUrl: browser.runtime.getURL("icon.png")
      });
    }

    await browser.storage.local.set({ [cfg.seenKey]: [...seen].slice(-200) });
  } catch (e) {
    console.debug(`[Rolimon's] ${type} notification check failed`, e);
  }
}

async function ensureAlarm() {
  const cfg = await getNotificationSettings();
  const enabledTypes = Object.keys(TRADE_TYPES).filter(type => {
    return !!cfg[`${type}Enabled`];
  });
  const existing = await browser.alarms.get(ALARM_NAME);

  if (!enabledTypes.length) {
    if (existing) await browser.alarms.clear(ALARM_NAME);
    return;
  }

  if (!existing) await browser.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });

  for (const type of enabledTypes) {
    const state = await browser.storage.local.get(TRADE_TYPES[type].initKey);
    if (!state[TRADE_TYPES[type].initKey]) await seedTradeBaseline(type);
  }

  for (const type of enabledTypes) await pollTradeType(type);
}

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM_NAME) return;
  getNotificationSettings()
    .then(cfg => Promise.all(
      Object.keys(TRADE_TYPES)
        .filter(type => cfg[`${type}Enabled`])
        .map(type => pollTradeType(type))
    ))
    .catch(() => {});
});

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes[NOTIFY_SETTINGS_KEY]) return;
  const oldCfg = changes[NOTIFY_SETTINGS_KEY].oldValue || {};
  const newCfg = changes[NOTIFY_SETTINGS_KEY].newValue || {};

  for (const type of Object.keys(TRADE_TYPES)) {
    const key = `${type}Enabled`;
    if (!oldCfg[key] && newCfg[key]) {
      const def = TRADE_TYPES[type];
      await browser.storage.local.set({ [def.initKey]: false, [def.seenKey]: [] });
    }
  }
  await ensureAlarm();
});

browser.notifications.onClicked.addListener(async (notificationId) => {
  const m = String(notificationId || "").match(/^rolimons-(?:inbound|declined|completed)-(\d+)$/);
  const url = m ? `https://www.roblox.com/trades/${m[1]}` : "https://www.roblox.com/trades";
  try { await browser.tabs.create({ url }); } catch (_) {}
});

browser.runtime.onStartup?.addListener(ensureAlarm);
browser.runtime.onInstalled?.addListener(ensureAlarm);
ensureAlarm();

// ---- Auto trade ads (Rolimon's) ----
const AD_KEY = "tradeAdSettings";
const AD_STATUS_KEY = "tradeAdStatus";
const AD_ALARM = "rolimons-trade-ad";
const AD_CREATE_URL = "https://api.rolimons.com/tradeads/v1/createad";
const AD_TAGS = ["any", "demand", "rares", "robux", "upgrade", "downgrade", "rap", "wishlist", "projecteds", "adds"];
let adPosting = false;

async function setAdStatus(ok, message) {
  await browser.storage.local.set({ [AD_STATUS_KEY]: { at: Date.now(), ok, message } });
  return { ok, message };
}

async function getAdSettings() {
  const stored = await browser.storage.local.get(AD_KEY);
  return { enabled: false, intervalMin: 20, playerId: "", offer: [], request: [], tags: [], ...(stored[AD_KEY] || {}) };
}

async function detectPlayerId() {
  const res = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't detect your Roblox account. Log in to Roblox or enter your user ID.");
  const data = await res.json();
  if (!data?.id) throw new Error("Couldn't detect your Roblox user ID.");
  return Number(data.id);
}


async function postTradeAd() {
  if (adPosting) return { ok: false, message: "Already posting an ad." };
  adPosting = true;
  try {
    const cfg = await getAdSettings();
    const offer = cfg.offer.map(Number).filter(Boolean).slice(0, 4);
    const request = cfg.request.map(Number).filter(Boolean).slice(0, 4);
    const tags = cfg.tags.filter(t => AD_TAGS.includes(t)).slice(0, 4);
    if (!offer.length) return setAdStatus(false, "Add at least one item to offer first.");
    if (!request.length && !tags.length) return setAdStatus(false, "Add at least one requested item or tag.");

    let playerId = Number(cfg.playerId);
    if (!playerId) playerId = await detectPlayerId();

    const res = await fetch(AD_CREATE_URL, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_id: playerId,
        offer_item_ids: offer,
        request_item_ids: request,
        request_tags: tags
      })
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.ok && data?.success !== false) return setAdStatus(true, "Trade ad posted.");

    const reason = data?.message || data?.error || "";
    if (res.status === 401 || res.status === 403) return setAdStatus(false, "Not logged in to Rolimon's. Log in at rolimons.com, then try again.");
    if (res.status === 429) return setAdStatus(false, "Rolimon's rate limit: one ad every 15 minutes.");
    return setAdStatus(false, reason ? `Rolimon's: ${reason}` : `Rolimon's returned HTTP ${res.status}.`);
  } catch (e) {
    return setAdStatus(false, e.message || "Posting failed.");
  } finally {
    adPosting = false;
  }
}

// ---- My inventory (for picking trade ad offers) ----
async function fetchMyInventory() {
  const cfg = await getAdSettings();
  let playerId = Number(cfg.playerId);
  if (!playerId) playerId = await detectPlayerId();

  // 1) Rolimon's: one request, already keyed by item id.
  try {
    const res = await fetch(`https://api.rolimons.com/players/v1/playerassets/${playerId}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data?.success !== false && data?.playerAssets && typeof data.playerAssets === "object") {
        const assets = {};
        for (const [id, uaids] of Object.entries(data.playerAssets)) {
          const n = Array.isArray(uaids) ? uaids.length : 1;
          if (n > 0) assets[id] = n;
        }
        return { ok: true, playerId, assets, source: "rolimons" };
      }
    }
  } catch (_) {}

  // 2) Fallback: Roblox collectibles inventory (works for your own inventory while logged in).
  const assets = {};
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const url = `https://inventory.roblox.com/v1/users/${playerId}/assets/collectibles?limit=100&sortOrder=Asc` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const res = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 403 ? "Your inventory is private." : `Inventory request failed (HTTP ${res.status}).`);
    const data = await res.json();
    for (const it of data?.data || []) assets[it.assetId] = (assets[it.assetId] || 0) + 1;
    cursor = data?.nextPageCursor || "";
    if (!cursor) break;
  }
  return { ok: true, playerId, assets, source: "roblox" };
}

async function ensureAdAlarm() {
  const cfg = await getAdSettings();
  const interval = Math.min(1440, Math.max(15, Math.floor(Number(cfg.intervalMin)) || 20));
  const existing = await browser.alarms.get(AD_ALARM);
  if (!cfg.enabled) {
    if (existing) await browser.alarms.clear(AD_ALARM);
    return;
  }
  if (!existing || existing.periodInMinutes !== interval) {
    await browser.alarms.create(AD_ALARM, { delayInMinutes: 1, periodInMinutes: interval });
  }
}

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== AD_ALARM) return;
  getAdSettings().then(cfg => { if (cfg.enabled) return postTradeAd(); }).catch(() => {});
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[AD_KEY]) ensureAdAlarm().catch(() => {});
});

browser.runtime.onStartup?.addListener(ensureAdAlarm);
browser.runtime.onInstalled?.addListener(ensureAdAlarm);
ensureAdAlarm();

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "getRolimonsItems") {
    return getItems()
      .then(items => ({ ok: true, items }))
      .catch(error => ({ ok: false, error: error.message }));
  }
  if (message?.type === "getRoutilityValue" && message.id != null) {
    return fetchRoutilityValue(message.id)
      .then(value => ({ ok: value != null, value }))
      .catch(error => ({ ok: false, value: null, error: error.message }));
  }
  if (message?.type === "getRoutilityStats" && message.id != null) {
    return fetchRoutilityStats(message.id)
      .then(stats => ({ ok: stats != null, stats }))
      .catch(error => ({ ok: false, stats: null, error: error.message }));
  }
  if (message?.type === "getRolimonsHistory" && message.id != null) {
    return fetchRolimonsHistory(message.id)
      .then(data => ({ ok: true, data }))
      .catch(error => ({ ok: false, error: error.message }));
  }
  if (message?.type === "getMyInventory") {
    return fetchMyInventory().catch(e => ({ ok: false, error: e.message || "Couldn't load your inventory." }));
  }
  if (message?.type === "postTradeAdNow") {
    return postTradeAd().catch(e => ({ ok: false, message: e.message }));
  }
  if (message?.type === "refreshTradeNotifications") {
    return ensureAlarm().then(() => ({ ok: true }));
  }
  return undefined;
});
