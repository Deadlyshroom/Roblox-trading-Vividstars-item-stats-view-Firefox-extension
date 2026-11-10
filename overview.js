// Inventory overview for any player's profile (public inventories only).
(() => {
  const USER_RE = /^\/users\/(\d+)(?:\/|$)/i;
  const USD_KEY = "overviewUsdPer1k";
  const ENABLED_KEY = "inventoryOverviewEnabled";
  const CHUNK = 60;
  const fmt = n => Math.round(Number(n) || 0).toLocaleString();
  const short = n => n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
  const DEMAND = { 0: "Terrible", 1: "Low", 2: "Normal", 3: "High", 4: "Amazing" };

  let enabled = true, usdPer1k = 3, btn = null, overlay = null, token = 0;
  let rolimons = null;

  function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const userId = () => (location.pathname.match(USER_RE) || [])[1] || null;

  function css() {
    if (document.getElementById("rov-style")) return;
    const st = document.createElement("style");
    st.id = "rov-style";
    st.textContent = `
      #rov-open{position:fixed;left:16px;bottom:16px;z-index:2147483000;background:#1b2a4a;color:#fff;border:1px solid #3a5a9a;border-radius:999px;padding:10px 16px;font:700 13px/16px Arial,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4)}
      #rov-open:hover{background:#25396a}
      #rov-overlay{position:fixed;inset:0;z-index:2147483001;background:rgba(5,8,14,.78);display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif}
      #rov-modal{width:min(1100px,96vw);height:min(86vh,900px);background:#10151f;color:#e8ecf3;border:1px solid #263047;border-radius:14px;display:flex;flex-direction:column;overflow:hidden}
      #rov-modal header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #1f2838}
      #rov-modal header h2{margin:0;font-size:17px}
      #rov-modal header small{display:block;color:#8a96ad;font-size:12px;margin-top:2px}
      #rov-close{background:#1c2536;color:#e8ecf3;border:0;border-radius:8px;width:32px;height:32px;font-size:16px;cursor:pointer}
      .rov-body{padding:14px 18px;overflow:hidden;display:flex;flex-direction:column;gap:12px;min-height:0;flex:1}
      .rov-stats{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr 1.2fr;gap:10px}
      .rov-stat{background:#161d2b;border:1px solid #232d42;border-radius:10px;padding:12px;min-width:0}
      .rov-stat.worth{border-color:#8a6d1f;background:#201b0f}
      .rov-stat span{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8a96ad}
      .rov-stat strong{display:block;font-size:22px;margin:4px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .rov-stat small{color:#8a96ad;font-size:11px}
      .rov-stat.worth strong{color:#f7c948}.rov-stat.val strong{color:#34d399}.rov-stat.rap strong{color:#60a5fa}
      .rov-stat input{width:56px;background:#0d121b;color:#e8ecf3;border:1px solid #2f3b55;border-radius:5px;padding:2px 4px;font-size:11px}
      .rov-tools{display:flex;gap:10px}
      .rov-tools input,.rov-tools select{background:#161d2b;color:#e8ecf3;border:1px solid #232d42;border-radius:8px;padding:10px 12px;font-size:13px}
      .rov-tools input{flex:1;min-width:0}
      .rov-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;overflow-y:auto;min-height:0;flex:1;align-content:start;padding-right:4px}
      .rov-card{background:#161d2b;border:1px solid #232d42;border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:3px;font-size:12px}
      .rov-card .img{height:96px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;background:#0d121b;border-radius:8px}
      .rov-card img{max-width:92px;max-height:92px}
      .rov-card .nm{font-weight:700;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .rov-card .r{display:flex;justify-content:space-between;color:#8a96ad}
      .rov-card .r b{color:#34d399}.rov-card .r.rp b{color:#60a5fa}
      .rov-card .sub{color:#8a96ad;font-size:11px}
      .rov-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}
      .rov-tag{font-size:9px;font-weight:700;letter-spacing:.05em;padding:2px 6px;border-radius:5px;background:#26304a;color:#b9c3d8;text-transform:uppercase}
      .rov-tag.rare{background:#3b2a63;color:#c9a8ff}.rov-tag.proj{background:#4a2b1f;color:#ffb48a}
      .rov-tag.d-terrible,.rov-tag.d-low{background:#4a1f26;color:#ff8c9b}.rov-tag.d-high,.rov-tag.d-amazing{background:#143a2b;color:#4ade80}
      .rov-msg{padding:40px 10px;text-align:center;color:#8a96ad;font-size:14px}
      @media (max-width:800px){.rov-stats{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(st);
  }

  async function loadRolimons() {
    if (rolimons) return rolimons;
    const res = await browser.runtime.sendMessage({ type: "getRolimonsItems" });
    if (!res?.ok || !res.items) throw new Error(res?.error || "Couldn't load Rolimon's values.");
    rolimons = res.items;
    return rolimons;
  }

  // A positive set Value wins; otherwise RAP (same rule as the trade page).
  function itemInfo(id, d) {
    const rap = Number(d[2]) > 0 ? Number(d[2]) : 0;
    const set = Number(d[3]);
    return {
      id, name: d[0] || `Item ${id}`, acronym: d[1] || "", rap, value: set > 0 ? set : rap,
      demand: DEMAND[d[5]] || "", projected: Number(d[7]) === 1, rare: Number(d[9]) === 1
    };
  }

  function buildModel(assets, items) {
    const rows = [];
    let totalValue = 0, totalRap = 0, count = 0, rare = 0, proj = 0, unknown = 0;
    for (const [id, copies] of Object.entries(assets)) {
      const d = items[id];
      if (!d) { unknown += copies; continue; }
      const it = itemInfo(id, d);
      rows.push({ ...it, copies, serial: null });
      totalValue += it.value * copies; totalRap += it.rap * copies; count += copies;
      if (it.rare) rare++;
      if (it.projected) proj++;
    }
    return { rows, totalValue, totalRap, count, unique: rows.length, rare, proj, unknown };
  }

  function close() { token++; overlay?.remove(); overlay = null; document.removeEventListener("keydown", onKey, true); }
  function onKey(e) { if (e.key === "Escape") close(); }

  async function open() {
    const id = userId();
    if (!id || overlay) return;
    css();
    const my = ++token;
    overlay = mk("div"); overlay.id = "rov-overlay";
    overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
    const modal = mk("div"); modal.id = "rov-modal";
    const header = mk("header");
    const t = mk("div");
    const nameEl = document.querySelector("h1, .profile-name, [class*='profile-header'] [class*='name']");
    t.append(mk("h2", "", "Inventory overview"), mk("small", "", (nameEl?.textContent || "").trim().slice(0, 40) || `User ${id}`));
    const x = mk("button", "", "✕"); x.id = "rov-close"; x.type = "button"; x.addEventListener("click", close);
    header.append(t, x);
    const body = mk("div", "rov-body");
    body.appendChild(mk("div", "rov-msg", "Loading inventory…"));
    modal.append(header, body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);

    try {
      const [inv, items] = await Promise.all([
        browser.runtime.sendMessage({ type: "getPlayerAssets", userId: id }),
        loadRolimons()
      ]);
      if (my !== token) return;
      if (!inv?.ok) throw new Error(inv?.error || "Couldn't load that inventory.");
      if (inv.privacy) { body.textContent = ""; body.appendChild(mk("div", "rov-msg", "This player's inventory is private, so their limiteds can't be shown.")); return; }
      const model = buildModel(inv.assets, items);
      if (!model.rows.length) { body.textContent = ""; body.appendChild(mk("div", "rov-msg", "No limited items found for this player.")); return; }
      render(body, model, id, my);
    } catch (e) {
      if (my !== token) return;
      body.textContent = "";
      body.appendChild(mk("div", "rov-msg", e.message));
    }
  }

  function render(body, model, uid, my) {
    body.textContent = "";
    const stats = mk("div", "rov-stats");
    const stat = (cls, label, big, small) => { const s = mk("div", "rov-stat " + cls); s.append(mk("span", "", label), mk("strong", "", big), mk("small", "", small)); return s; };
    const worth = stat("worth", "Estimated worth", "", "");
    const worthBig = worth.querySelector("strong");
    const worthSmall = worth.querySelector("small");
    const rate = document.createElement("input"); rate.type = "number"; rate.min = "0"; rate.step = "0.5"; rate.value = String(usdPer1k);
    const setWorth = () => { worthBig.textContent = "$" + (model.totalValue / 1000 * usdPer1k).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    worthSmall.append(document.createTextNode("Based on $ "), rate, document.createTextNode(" / 1k value"));
    setWorth();
    rate.addEventListener("input", () => {
      const n = Number(rate.value);
      if (Number.isFinite(n) && n >= 0) { usdPer1k = n; setWorth(); try { browser.storage.local.set({ [USD_KEY]: n }); } catch (_) {} }
    });
    const best = model.rows.reduce((a, b) => (b.value > a.value ? b : a), model.rows[0]);
    const bestStat = stat("best", "Best item", best.name, `${fmt(best.value)} value`);
    bestStat.querySelector("strong").style.fontSize = "16px";
    stats.append(
      worth,
      stat("val", "Total value", short(model.totalValue), `${fmt(model.totalValue)} exact`),
      stat("rap", "Total RAP", short(model.totalRap), `${fmt(model.totalRap)} exact`),
      stat("", "Items", fmt(model.count), `${fmt(model.unique)} unique · ${model.rare} rare · ${model.proj} proj` + (model.unknown ? ` · ${model.unknown} unlisted` : "")),
      bestStat
    );

    const tools = mk("div", "rov-tools");
    const search = document.createElement("input"); search.type = "search"; search.placeholder = "Search items by name…"; search.autocomplete = "off";
    const sort = document.createElement("select");
    [["vd", "Value: High → Low"], ["va", "Value: Low → High"], ["rd", "RAP: High → Low"], ["cd", "Copies: Most"], ["nm", "Name: A → Z"]]
      .forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; sort.appendChild(o); });
    tools.append(search, sort);

    const grid = mk("div", "rov-grid");
    body.append(stats, tools, grid);

    let view = [], shown = 0;
    const thumbs = {};
    const cmp = {
      vd: (a, b) => b.value - a.value, va: (a, b) => a.value - b.value, rd: (a, b) => b.rap - a.rap,
      cd: (a, b) => b.copies - a.copies || b.value - a.value, nm: (a, b) => a.name.localeCompare(b.name)
    };
    function card(r) {
      const c = mk("div", "rov-card");
      const img = mk("div", "img");
      const im = document.createElement("img"); im.alt = ""; im.dataset.id = r.id; im.loading = "lazy";
      if (thumbs[r.id]) im.src = thumbs[r.id];
      img.appendChild(im);
      c.append(img, mk("div", "nm", r.name));
      c.querySelector(".nm").title = r.name;
      const v = mk("div", "r"); v.append(mk("span", "", "Value"), mk("b", "", fmt(r.value)));
      const p = mk("div", "r rp"); p.append(mk("span", "", "RAP"), mk("b", "", fmt(r.rap)));
      c.append(v, p);
      const sub = [];
      if (r.copies > 1) sub.push(`×${r.copies}`);
      if (r.serial != null) sub.push(`#${r.serial}`);
      if (sub.length) { const s = mk("div", "sub", sub.join(" · ")); s.dataset.sub = r.id; c.appendChild(s); }
      const tags = mk("div", "rov-tags");
      if (r.rare) tags.appendChild(mk("span", "rov-tag rare", "Rare"));
      if (r.projected) tags.appendChild(mk("span", "rov-tag proj", "Projected"));
      if (r.demand) tags.appendChild(mk("span", "rov-tag d-" + r.demand.toLowerCase(), r.demand));
      if (tags.childNodes.length) c.appendChild(tags);
      return c;
    }
    async function fillThumbs(rows) {
      const need = rows.map(r => r.id).filter(i => !thumbs[i]);
      for (let i = 0; i < need.length; i += 100) {
        const res = await browser.runtime.sendMessage({ type: "getThumbnails", ids: need.slice(i, i + 100) }).catch(() => null);
        if (my !== token) return;
        Object.assign(thumbs, res?.urls || {});
      }
      grid.querySelectorAll("img[data-id]").forEach(im => { if (!im.src && thumbs[im.dataset.id]) im.src = thumbs[im.dataset.id]; });
    }
    function more() {
      const next = view.slice(shown, shown + CHUNK);
      next.forEach(r => grid.appendChild(card(r)));
      shown += next.length;
      fillThumbs(next);
    }
    function refresh() {
      const q = search.value.trim().toLowerCase();
      view = model.rows.filter(r => !q || r.name.toLowerCase().includes(q) || (r.acronym && r.acronym.toLowerCase() === q)).sort(cmp[sort.value]);
      grid.textContent = ""; shown = 0; grid.scrollTop = 0;
      if (!view.length) { grid.appendChild(mk("div", "rov-msg", "No items match.")); return; }
      more();
    }
    grid.addEventListener("scroll", () => { if (shown < view.length && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 300) more(); });
    let st; search.addEventListener("input", () => { clearTimeout(st); st = setTimeout(refresh, 200); });
    sort.addEventListener("change", refresh);
    refresh();
    loadSerials(uid, model, my, () => { if (my === token) refresh(); });
  }

  // Best effort: lowest serial per item from Roblox's collectibles list. Skipped quietly if blocked or rate limited.
  async function loadSerials(uid, model, my, done) {
    const lowest = new Map();
    let cursor = null;
    try {
      for (let page = 0; page < 25; page++) {
        const r = await browser.runtime.sendMessage({ type: "getPlayerSerials", userId: uid, cursor });
        if (my !== token || !r?.ok) break;
        for (const it of r.items) if (it.serial != null) { const k = String(it.assetId); if (!lowest.has(k) || it.serial < lowest.get(k)) lowest.set(k, it.serial); }
        cursor = r.next;
        if (!cursor) break;
        await new Promise(res => setTimeout(res, 400));
      }
    } catch (_) {}
    if (my !== token || !lowest.size) return;
    model.rows.forEach(r => { if (lowest.has(r.id)) r.serial = lowest.get(r.id); });
    done();
  }

  function sync() {
    const id = userId();
    if (!enabled || !id) { btn?.remove(); btn = null; if (overlay) close(); return; }
    if (btn?.isConnected) return;
    css();
    btn = mk("button", "", "📊 Inventory overview"); btn.id = "rov-open"; btn.type = "button";
    btn.addEventListener("click", open);
    document.body.appendChild(btn);
  }

  (async () => {
    try {
      const s = await browser.storage.local.get([ENABLED_KEY, USD_KEY]);
      enabled = s[ENABLED_KEY] !== false;
      if (Number.isFinite(Number(s[USD_KEY])) && s[USD_KEY] !== undefined) usdPer1k = Number(s[USD_KEY]);
    } catch (_) {}
    sync();
    setInterval(sync, 1000);   // Roblox is a single-page app: follow profile-to-profile navigation
    browser.storage.onChanged.addListener((c, area) => {
      if (area === "local" && c[ENABLED_KEY]) { enabled = c[ENABLED_KEY].newValue !== false; sync(); }
    });
  })();
})();
