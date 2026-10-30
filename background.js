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
    title: "Roblox Trade",
    message: "New inbound trade"
  },
  declined: {
    seenKey: "rolimonsSeenDeclinedTrades",
    initKey: "rolimonsDeclinedInitialized",
    path: "declined",
    title: "Roblox Trade",
    message: "Trade declined."
  },
  completed: {
    seenKey: "rolimonsSeenCompletedTrades",
    initKey: "rolimonsCompletedInitialized",
    path: "completed",
    title: "Roblox Trade",
    message: "Trade completed."
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

// ---- Rolimon's copy counts (Total / Premium / Available / Hoarded) ----
const COPIES_CACHE_TTL = 10 * 60 * 1000;
const copiesCache = new Map();

// Reads the copy counts off a Rolimon's item page. The page text is scanned for "<Label> <number>"
// (and the "<number> Available Copies" form used in the meta description), and any embedded JS object
// with copy-like keys is checked as a fallback, so a small layout change upstream doesn't break it.
function parseRolimonsCopies(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
  const metaText = (/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)["']/i.exec(html) || [])[1] || "";
  const toNum = (s) => { const n = Number(String(s).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
  const NUM = "([0-9][0-9,]*)";
  const find = (labelRe) => {
    const src = labelRe.source;
    let m = new RegExp(src + "\\s*[:\\-·|]?\\s*" + NUM, "i").exec(text);   // "Premium Copies 1,234"
    if (m) return toNum(m[m.length - 1]);
    m = new RegExp(NUM + "\\s+" + src, "i").exec(metaText);                    // "there are 769 Available Copies"
    return m ? toNum(m[1]) : null;
  };
  const out = {
    total: find(/Total\s+Copies/),
    premium: find(/Premium\s+Copies/),
    available: find(/Available\s+Copies/),
    hoarded: find(/Hoarded\s+Copies/)
  };
  // Fallback: a JS object with copy-like keys (e.g. item_details / owner stats).
  if (out.total == null || out.premium == null) {
    for (const name of ["item_details", "item_data", "copies_data", "owner_data", "ownership_data"]) {
      const o = extractJsLiteral(html, name);
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      const pick = (re) => { const k = Object.keys(o).find(x => re.test(x) && Number.isFinite(Number(o[x]))); return k ? Number(o[k]) : null; };
      if (out.premium == null) out.premium = pick(/premium/i);
      if (out.total == null) out.total = pick(/^(total_)?copies$|total_copies|num_copies/i);
      if (out.available == null) out.available = pick(/available/i);
      if (out.hoarded == null) out.hoarded = pick(/hoard/i);
    }
  }
  return out;
}

async function fetchRolimonsCopies(id) {
  const key = String(id);
  const hit = copiesCache.get(key);
  if (hit && Date.now() - hit.at < COPIES_CACHE_TTL) return hit.data;
  const response = await fetch(`https://www.rolimons.com/item/${encodeURIComponent(key)}`, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`Rolimon's item page HTTP ${response.status}`);
  const data = parseRolimonsCopies(await response.text());
  copiesCache.set(key, { data, at: Date.now() });
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

// ---- Trade notifications (inbound / declined / completed) ----
const NOTIFY_POLL_MIN = 2;
const NOTIFY_SEEN_LIMIT = 200;
let notifyChecking = false;

async function ensureAlarm() {
  const s = await getNotificationSettings();
  const any = s.inboundEnabled || s.declinedEnabled || s.completedEnabled;
  const existing = await browser.alarms.get(ALARM_NAME);
  if (!any) {
    if (existing) await browser.alarms.clear(ALARM_NAME);
    return;
  }
  if (!existing || existing.periodInMinutes !== NOTIFY_POLL_MIN) {
    await browser.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: NOTIFY_POLL_MIN });
  }
}

function playNotificationSound() {
  try {
    const Ctx = self.AudioContext || self.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close().catch(() => {});
  } catch (_) {}
}

async function checkTradeNotifications() {
  if (notifyChecking) return;
  notifyChecking = true;
  try {
    const settings = await getNotificationSettings();
    let notified = false;
    for (const [type, cfg] of Object.entries(TRADE_TYPES)) {
      if (!settings[type + "Enabled"]) continue;
      let list;
      try { list = await fetchTradeList(type); } catch (_) { continue; }   // not logged in / rate limited: try next time
      const ids = list.map(t => t?.id).filter(id => id != null);
      const stored = await browser.storage.local.get([cfg.seenKey, cfg.initKey]);
      const seen = new Set(Array.isArray(stored[cfg.seenKey]) ? stored[cfg.seenKey] : []);
      if (stored[cfg.initKey]) {
        // oldest first, so notifications arrive in order
        for (const id of ids.filter(id => !seen.has(id)).reverse()) {
          await browser.notifications.create(`rolimons-${type}-${id}`, {
            type: "basic",
            iconUrl: browser.runtime.getURL("icon.png"),
            title: cfg.title,
            message: cfg.message
          });
          notified = true;
        }
      }
      // first run only records what already exists, so enabling this never floods you
      await browser.storage.local.set({
        [cfg.seenKey]: [...new Set([...ids, ...seen])].slice(0, NOTIFY_SEEN_LIMIT),
        [cfg.initKey]: true
      });
    }
    if (notified && settings.inboundSound) playNotificationSound();
  } finally {
    notifyChecking = false;
  }
}

browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) checkTradeNotifications().catch(() => {});
});

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes[NOTIFY_SETTINGS_KEY]) return;
  const before = changes[NOTIFY_SETTINGS_KEY].oldValue || {};
  const after = changes[NOTIFY_SETTINGS_KEY].newValue || {};
  const reset = {};
  for (const [type, cfg] of Object.entries(TRADE_TYPES)) {
    if (after[type + "Enabled"] && !before[type + "Enabled"]) reset[cfg.initKey] = false;   // re-baseline when turned on
  }
  try {
    if (Object.keys(reset).length) await browser.storage.local.set(reset);
    await ensureAlarm();
    await checkTradeNotifications();
  } catch (_) {}
});

browser.notifications?.onClicked?.addListener(id => {
  if (String(id).startsWith("rolimons-")) browser.tabs.create({ url: "https://www.roblox.com/trades" }).catch(() => {});
});

// ---- Roblox RAP, used when Rolimon's has no value for an item (e.g. new faces / dynamic heads) ----
const liveRapCache = new Map();
async function fetchLiveRap(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error("Bad item id.");
  const hit = liveRapCache.get(n);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.rap;
  const res = await fetch(`https://economy.roblox.com/v1/assets/${n}/resale-data`, { credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const rap = Number(j?.recentAveragePrice);
  const out = Number.isFinite(rap) && rap > 0 ? rap : null;
  liveRapCache.set(n, { at: Date.now(), rap: out });
  return out;
}

// ---- Player inventory overview (any player with a public inventory) ----
const INV_CACHE_TTL = 5 * 60 * 1000;
const invCache = new Map();

function validUserId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 1e13) throw new Error("Bad user id.");
  return n;
}

async function fetchPlayerAssets(userId) {
  const id = validUserId(userId);
  const hit = invCache.get(id);
  if (hit && Date.now() - hit.at < INV_CACHE_TTL) return hit.data;
  const res = await fetch(`https://api.rolimons.com/players/v1/playerassets/${id}`, { cache: "no-store" });
  if (res.status === 429) throw new Error("Rolimon's is rate limiting requests. Try again in a minute.");
  if (!res.ok) throw new Error(`Rolimon's returned HTTP ${res.status}.`);
  const json = await res.json();
  if (json?.success === false) throw new Error(json.message || "Rolimon's has no data for this player.");
  if (json?.playerPrivacyEnabled) return { privacy: true, assets: {} };
  const assets = {};
  for (const [aid, uaids] of Object.entries(json?.playerAssets || {})) {
    const n = Array.isArray(uaids) ? uaids.length : 1;
    if (n > 0) assets[aid] = n;
  }
  const data = { privacy: false, assets, scannedAt: json?.scannedAt || null };
  invCache.set(id, { at: Date.now(), data });
  return data;
}

// One page of Roblox collectibles (has serial numbers). Public inventories only.
async function fetchSerialPage(userId, cursor) {
  const id = validUserId(userId);
  const url = `https://inventory.roblox.com/v1/users/${id}/assets/collectibles?limit=100&sortOrder=Asc` +
    (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
  const res = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (res.status === 429) return { ok: false, rateLimited: true };
  if (!res.ok) return { ok: false, status: res.status };
  const j = await res.json();
  return {
    ok: true,
    items: (j?.data || []).map(x => ({ assetId: x.assetId, serial: x.serialNumber ?? null })),
    next: j?.nextPageCursor || null
  };
}

const thumbCache = new Map();
async function fetchThumbnails(ids) {
  const want = [...new Set((ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 100);
  const need = want.filter(i => !thumbCache.has(i));
  if (need.length) {
    const res = await fetch(`https://thumbnails.roblox.com/v1/assets?assetIds=${need.join(",")}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`, { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      for (const t of j?.data || []) if (t?.imageUrl && /^https:\/\/[a-z0-9.-]*rbxcdn\.com\//i.test(t.imageUrl)) thumbCache.set(Number(t.targetId), t.imageUrl);
    }
  }
  const out = {};
  want.forEach(i => { if (thumbCache.has(i)) out[i] = thumbCache.get(i); });
  return out;
}

// ---- Auto trade ads (Rolimon's) ----
const AD_KEY = "tradeAdSettings";
const AD_STATUS_KEY = "tradeAdStatus";
const AD_ALARM = "rolimons-trade-ad";
const AD_MAX_ITEMS = 4, AD_MAX_TAGS = 4;
const AD_TAGS = ["any", "demand", "rares", "robux", "upgrade", "downgrade", "rap", "wishlist", "projecteds", "adds"];
const AD_DEFAULTS = { enabled: false, intervalMin: 20, playerId: "", offer: [], request: [], tags: [] };

async function getAdSettings() {
  const stored = await browser.storage.local.get(AD_KEY);
  const cfg = { ...AD_DEFAULTS, ...(stored[AD_KEY] || {}) };
  const ids = v => (Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, AD_MAX_ITEMS);
  cfg.offer = ids(cfg.offer);
  cfg.request = ids(cfg.request);
  cfg.tags = (Array.isArray(cfg.tags) ? cfg.tags : []).filter(t => AD_TAGS.includes(t)).slice(0, AD_MAX_TAGS);
  cfg.enabled = !!cfg.enabled;
  cfg.intervalMin = Math.min(1440, Math.max(15, Math.floor(Number(cfg.intervalMin)) || AD_DEFAULTS.intervalMin));
  cfg.playerId = String(cfg.playerId || "").replace(/\D/g, "");
  return cfg;
}

async function setAdStatus(ok, message) {
  try { await browser.storage.local.set({ [AD_STATUS_KEY]: { at: Date.now(), ok, message } }); } catch (_) {}
  return { ok, message };
}

// The Roblox account that is logged in in this browser.
async function detectPlayerId() {
  const res = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Couldn't detect your Roblox account. Log in at roblox.com, or enter your user ID under Advanced.");
  const j = await res.json();
  const id = Number(j?.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Couldn't detect your Roblox account. Enter your user ID under Advanced.");
  return id;
}

async function postTradeAd() {
  try {
    const cfg = await getAdSettings();
    if (!cfg.offer.length) return await setAdStatus(false, "Add at least one item to offer first.");
    if (!cfg.request.length && !cfg.tags.length) return await setAdStatus(false, "Add a requested item or tag first.");
    const playerId = Number(cfg.playerId) || await detectPlayerId();

    const res = await fetch("https://api.rolimons.com/tradeads/v1/createad", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_id: playerId,
        offer_item_ids: cfg.offer,
        request_item_ids: cfg.request,
        request_tags: cfg.tags
      })
    });
    let j = null;
    try { j = await res.json(); } catch (_) {}
    if (res.ok && j?.success !== false) return await setAdStatus(true, "Trade ad posted.");
    if (res.status === 401 || res.status === 403) return await setAdStatus(false, "Rolimon's says you're not logged in. Log in at rolimons.com in this browser, then try again.");
    if (res.status === 429) return await setAdStatus(false, "Rolimon's allows one ad every 15 minutes. Try again a bit later.");
    return await setAdStatus(false, j?.message || `Rolimon's returned HTTP ${res.status}.`);
  } catch (e) {
    return await setAdStatus(false, e?.message || "Couldn't post the trade ad.");
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

browser.runtime.onStartup?.addListener(() => { ensureAdAlarm().catch(() => {}); ensureAlarm().catch(() => {}); });
browser.runtime.onInstalled?.addListener(() => { ensureAdAlarm().catch(() => {}); ensureAlarm().catch(() => {}); });
ensureAdAlarm().catch(() => {});
ensureAlarm().catch(() => {});

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
  if (message?.type === "getRolimonsCopies" && message.id != null) {
    return fetchRolimonsCopies(message.id)
      .then(data => ({ ok: true, data }))
      .catch(error => ({ ok: false, error: error.message }));
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
  if (message?.type === "getLiveRap") {
    return fetchLiveRap(message.id).then(rap => ({ ok: rap != null, rap })).catch(() => ({ ok: false, rap: null }));
  }
  if (message?.type === "getPlayerAssets") {
    return fetchPlayerAssets(message.userId)
      .then(d => ({ ok: true, ...d }))
      .catch(e => ({ ok: false, error: e.message || "Couldn't load that inventory." }));
  }
  if (message?.type === "getPlayerSerials") {
    return fetchSerialPage(message.userId, message.cursor).catch(() => ({ ok: false }));
  }
  if (message?.type === "getThumbnails") {
    return fetchThumbnails(message.ids).then(urls => ({ ok: true, urls })).catch(() => ({ ok: false, urls: {} }));
  }
  if (message?.type === "refreshTradeNotifications") {
    return ensureAlarm().then(() => ({ ok: true }));
  }
  return undefined;
});


// ================= Auto decline trades =================
const AUTODECLINE_KEY = "autoDeclineSettings";
const AUTODECLINE_LOG_KEY = "autoDeclineLog";
const AUTODECLINE_SEEN_KEY = "autoDeclineChecked";
const AUTODECLINE_ALARM = "auto-decline-check";
const AUTODECLINE_DEFAULTS = {
  enabled: false, notify: true,
  percentEnabled: false, minPercent: 0,          // decline when my gain is below this % (negative allowed)
  demandLevel: "off",                            // off | 0 | 1 | 2  -> decline if an item I'd get has demand <= this
  declineProjected: false, declineLowering: false, declineRobuxAsk: false,
  blacklist: []                                  // [{ id, name }]
};
let autoDeclineRunning = false;
let _adCsrf = null;

async function getAutoDeclineSettings() {
  const s = (await browser.storage.local.get(AUTODECLINE_KEY))[AUTODECLINE_KEY] || {};
  return { ...AUTODECLINE_DEFAULTS, ...s, blacklist: Array.isArray(s.blacklist) ? s.blacklist : [] };
}

async function rbxRequest(url, method) {
  let r;
  for (let i = 0; i < 2; i++) {
    r = await fetch(url, {
      method, credentials: "include", cache: "no-store",
      headers: { "Content-Type": "application/json", ...(_adCsrf ? { "X-CSRF-TOKEN": _adCsrf } : {}) },
      body: method === "POST" ? "{}" : undefined
    });
    if (r.status === 403) { const t = r.headers.get("x-csrf-token"); if (t && t !== _adCsrf) { _adCsrf = t; continue; } }
    break;
  }
  return r;
}

async function adMyId() {
  const r = await fetch("https://users.roblox.com/v1/users/authenticated", { credentials: "include", cache: "no-store" });
  if (!r.ok) throw new Error("not logged in");
  return String((await r.json())?.id || "");
}

function adIdCandidates(it) {
  const out = [];
  const push = v => { const t = String(v ?? ""); if (/^\d{1,16}$/.test(t) && !out.includes(t)) out.push(t); };
  push(it?.assetId); push(it?.itemTarget?.targetId); push(it?.targetId); push(it?.asset?.id); push(it?.itemId);
  return out;
}

// Returns { mine: [{cands,name,rap}], theirs: [...], mineRobux, theirRobux } using v1, then v2 (faces / newer items).
async function adFetchTrade(id, me) {
  const norm = (list, v2) => (list || []).map(it => ({
    cands: adIdCandidates(it),
    name: String(v2 ? (it?.itemName ?? it?.name ?? "") : (it?.name ?? "")),
    rap: Number(it?.recentAveragePrice) || 0
  }));
  let data = null;
  try {
    const r = await rbxRequest(`https://trades.roblox.com/v1/trades/${encodeURIComponent(id)}`, "GET");
    if (r.ok) {
      const t = await r.json();
      const offers = Array.isArray(t?.offers) ? t.offers : [];
      const mine = offers.find(o => String(o?.user?.id) === String(me)), theirs = offers.find(o => o !== mine);
      if (mine && theirs) data = { mine: norm(mine.userAssets), theirs: norm(theirs.userAssets), mineRobux: Number(mine.robux) || 0, theirRobux: Number(theirs.robux) || 0 };
    }
  } catch (_) {}
  if (!data || [...data.mine, ...data.theirs].some(i => !i.cands.length)) {
    try {
      const r = await rbxRequest(`https://trades.roblox.com/v2/trades/${encodeURIComponent(id)}`, "GET");
      if (r.ok) {
        const t = await r.json();
        const A = t?.participantAOffer, B = t?.participantBOffer;
        const mine = String(A?.user?.id) === String(me) ? A : String(B?.user?.id) === String(me) ? B : null;
        const theirs = mine ? (mine === A ? B : A) : null;
        if (mine && theirs) data = { mine: norm(mine.items, true), theirs: norm(theirs.items, true), mineRobux: Number(mine.robux) || 0, theirRobux: Number(theirs.robux) || 0 };
      }
    } catch (_) {}
  }
  return data;
}

// Rolimon's fields: [name, acronym, RAP, Value, ?, demand, trend, projected, ...]
async function adResolveItem(it, items, byName) {
  let id = it.cands.find(c => items[c]) || byName.get(String(it.name).trim().toLowerCase()) || it.cands[0] || "";
  const d = items[id];
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const set = num(d?.[3]), rap = num(d?.[2]);
  let value = set > 0 ? set : rap;
  let fromRoblox = false;
  if (!(value > 0)) value = it.rap;
  if (!(value > 0) && id) { try { value = (await fetchLiveRap(id)) || 0; } catch (_) {} }
  if (!(value > 0)) fromRoblox = false;
  return {
    id, name: d?.[0] || it.name || `Item ${id}`, value,
    demand: d && Number(d[5]) >= 0 ? Number(d[5]) : null,
    trend: d && Number(d[6]) >= 0 ? Number(d[6]) : null,
    projected: !!d && (d[7] === 1 || d[7] === true) && !(set > 0)
  };
}

// Returns a reason string if the trade should be declined, otherwise null.
async function adEvaluate(trade, cfg, items, byName) {
  const [mine, theirs] = await Promise.all([
    Promise.all(trade.mine.map(i => adResolveItem(i, items, byName))),
    Promise.all(trade.theirs.map(i => adResolveItem(i, items, byName)))
  ]);
  const unknown = [...mine, ...theirs].some(i => !(i.value > 0));
  if (cfg.declineRobuxAsk && trade.mineRobux > 0) return { reason: `asks ${trade.mineRobux} Robux from you` };
  const demandMax = cfg.demandLevel === "off" ? null : Number(cfg.demandLevel);
  if (demandMax != null) {
    const bad = theirs.find(i => i.demand != null && i.demand <= demandMax);
    if (bad) return { reason: `${bad.name} has low demand` };
  }
  if (cfg.declineProjected) { const p = theirs.find(i => i.projected); if (p) return { reason: `${p.name} is projected` }; }
  if (cfg.declineLowering) { const l = theirs.find(i => i.trend === 0); if (l) return { reason: `${l.name} is lowering` }; }
  let pct = null;
  if (!unknown) {
    const mineValue = mine.reduce((a, i) => a + i.value, 0) + trade.mineRobux;
    const theirValue = theirs.reduce((a, i) => a + i.value, 0) + Math.floor(trade.theirRobux * 0.7);
    if (mineValue > 0) pct = ((theirValue - mineValue) / mineValue) * 100;
    if (cfg.percentEnabled && cfg.minPercent !== "" && pct != null && pct < Number(cfg.minPercent)) {
      return { reason: `${pct.toFixed(1)}% is below your ${Number(cfg.minPercent)}% limit`, pct };
    }
  }
  return { reason: null, pct };
}

async function adLog(entry) {
  const log = (await browser.storage.local.get(AUTODECLINE_LOG_KEY))[AUTODECLINE_LOG_KEY] || [];
  log.unshift({ t: Date.now(), ...entry });
  await browser.storage.local.set({ [AUTODECLINE_LOG_KEY]: log.slice(0, 50) });
}

async function checkAutoDecline() {
  if (autoDeclineRunning) return { ok: false, busy: true };
  autoDeclineRunning = true;
  let declined = 0;
  try {
    const cfg = await getAutoDeclineSettings();
    if (!cfg.enabled) return { ok: true, declined: 0 };
    const me = await adMyId();
    const lr = await rbxRequest("https://trades.roblox.com/v1/trades/inbound?sortOrder=Desc&limit=25", "GET");
    if (!lr.ok) throw new Error(`inbound HTTP ${lr.status}`);
    const list = (await lr.json())?.data || [];
    const seenArr = (await browser.storage.local.get(AUTODECLINE_SEEN_KEY))[AUTODECLINE_SEEN_KEY] || [];
    const seen = new Set(seenArr.map(String));
    const raw = await getItems();
    const items = raw?.items || raw || {};
    const byName = new Map(); const dup = new Set();
    for (const [id, d] of Object.entries(items)) { if (!Array.isArray(d) || !d[0]) continue; const k = String(d[0]).trim().toLowerCase(); if (byName.has(k)) dup.add(k); else byName.set(k, id); }
    dup.forEach(k => byName.delete(k));
    const black = new Set(cfg.blacklist.flatMap(b => [String(b.id), String(b.name || "").toLowerCase()]).filter(Boolean));

    for (const t of list) {
      const tid = String(t?.id ?? "");
      if (!tid || seen.has(tid)) continue;
      const sender = { id: String(t?.user?.id ?? ""), name: t?.user?.name || t?.user?.displayName || "Unknown" };
      let reason = null, pct = null;
      if (black.has(sender.id) || black.has(sender.name.toLowerCase())) reason = "blacklisted player";
      else {
        const trade = await adFetchTrade(tid, me).catch(() => null);
        if (!trade) continue;                       // couldn't read it: try again next minute
        const res = await adEvaluate(trade, cfg, items, byName);
        reason = res.reason; pct = res.pct ?? null;
      }
      if (reason) {
        const r = await rbxRequest(`https://trades.roblox.com/v1/trades/${encodeURIComponent(tid)}/decline`, "POST");
        if (!r.ok) continue;                        // retry next minute
      }
      seen.add(tid);
      if (reason) {
        declined++;
        await adLog({ id: tid, user: sender.name, reason, pct, dry: false });
        if (cfg.notify) browser.notifications.create(`rolimons-autodecline-${tid}`, {
          type: "basic", iconUrl: browser.runtime.getURL("icon.png"),
          title: "Trade auto declined",
          message: `${sender.name}: ${reason}`
        }).catch(() => {});
      }
    }
    await browser.storage.local.set({ [AUTODECLINE_SEEN_KEY]: [...seen].slice(-400) });
    return { ok: true, declined };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    autoDeclineRunning = false;
  }
}

async function ensureAutoDeclineAlarm() {
  const cfg = await getAutoDeclineSettings();
  const existing = await browser.alarms.get(AUTODECLINE_ALARM);
  if (!cfg.enabled) { if (existing) await browser.alarms.clear(AUTODECLINE_ALARM); return; }
  if (!existing || existing.periodInMinutes !== 1) await browser.alarms.create(AUTODECLINE_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
}

browser.alarms.onAlarm.addListener(a => { if (a.name === AUTODECLINE_ALARM) checkAutoDecline().catch(() => {}); });
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[AUTODECLINE_KEY]) ensureAutoDeclineAlarm().then(() => checkAutoDecline()).catch(() => {});
});
browser.runtime.onStartup?.addListener(() => ensureAutoDeclineAlarm().catch(() => {}));
browser.runtime.onInstalled?.addListener(() => ensureAutoDeclineAlarm().catch(() => {}));
ensureAutoDeclineAlarm().catch(() => {});
browser.runtime.onMessage.addListener(m => {
  if (m?.type === "autoDeclineCheckNow") return checkAutoDecline();
  return undefined;
});
