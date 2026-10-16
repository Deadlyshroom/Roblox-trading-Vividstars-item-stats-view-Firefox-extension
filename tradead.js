(() => {
  const KEY = "tradeAdSettings";
  const STATUS_KEY = "tradeAdStatus";
  const DEFAULTS = { enabled: false, intervalMin: 20, playerId: "", offer: [], request: [], tags: [] };
  const TAGS = ["any", "demand", "rares", "robux", "upgrade", "downgrade", "rap", "wishlist", "projecteds", "adds"];
  const MAX_ITEMS = 4, MAX_TAGS = 4;
  const $ = id => document.getElementById(id);

  let cfg = { ...DEFAULTS };
  let items = {};       // id -> { name, acronym, rap, value }
  let itemList = [];

  const fmt = n => Number(n || 0).toLocaleString();
  const nameOf = id => items[id]?.name || `Item ${id}`;

  async function loadItems() {
    try {
      const res = await browser.runtime.sendMessage({ type: "getRolimonsItems" });
      if (res?.ok && res.items) {
        for (const [id, d] of Object.entries(res.items)) {
          const value = d[3] > 0 ? d[3] : d[2];
          items[id] = { id, name: d[0], acronym: d[1] || "", rap: d[2], value };
        }
        itemList = Object.values(items);
      }
    } catch (e) { console.warn("item load failed", e); }
  }

  let inventory = null; // { itemId: count }
  let invLoading = false;

  function countIn(side, id) { return cfg[side].filter(x => Number(x) === Number(id)).length; }

  function renderInventory() {
    const grid = $("invGrid");
    grid.textContent = "";
    if (!inventory) return;
    const q = $("invFilter").value.trim().toLowerCase();
    const rows = Object.entries(inventory)
      .map(([id, owned]) => ({ id, owned, it: items[id] }))
      .filter(r => r.it && (!q || r.it.name.toLowerCase().includes(q) || (r.it.acronym && r.it.acronym.toLowerCase() === q)))
      .sort((a, b) => b.it.value - a.it.value);
    $("invStatus").textContent = rows.length
      ? `${rows.length} item${rows.length === 1 ? "" : "s"} · click to add to your offer, click again to remove`
      : (Object.keys(inventory).length ? "No items match." : "No limited items found in your inventory.");
    rows.forEach(({ id, owned, it }) => {
      const picked = countIn("offer", id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = picked ? "picked" : "";
      b.disabled = !picked && cfg.offer.length >= MAX_ITEMS;
      const n = document.createElement("span"); n.textContent = it.name;
      const v = document.createElement("small"); v.textContent = fmt(it.value);
      const o = document.createElement("em");
      o.textContent = `Owned ×${owned}` + (picked ? ` · ${picked} in offer` : "");
      b.append(n, v, o);
      b.addEventListener("click", () => {
        if (countIn("offer", id) >= owned) {            // no copies left: click again to remove
          const i = cfg.offer.map(Number).lastIndexOf(Number(id));
          if (i >= 0) cfg.offer.splice(i, 1);
        } else if (cfg.offer.length < MAX_ITEMS) {
          cfg.offer.push(Number(id));
        } else return;
        save(); renderAll();
      });
      grid.append(b);
    });
  }

  async function loadInventory() {
    if (invLoading) return;
    invLoading = true;
    $("invStatus").textContent = "Loading your inventory…";
    try {
      if (!itemList.length) await loadItems();
      const res = await browser.runtime.sendMessage({ type: "getMyInventory" });
      if (!res?.ok) throw new Error(res?.error || "Couldn't load your inventory.");
      inventory = res.assets || {};
      renderInventory();
    } catch (e) {
      inventory = null;
      $("invGrid").textContent = "";
      $("invStatus").textContent = e.message;
    }
    invLoading = false;
  }

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => browser.storage.local.set({ [KEY]: cfg }), 150);
  }

  const initials = id => {
    const it = items[id];
    const t = (it?.acronym || it?.name || "?").trim();
    return t.length <= 3 ? t.toUpperCase() : (!/\s/.test(t) ? t.slice(0, 3).toUpperCase() : t.split(/\s+/).map(w => w[0]).join("").slice(0, 3).toUpperCase());
  };
  const sumSide = side => cfg[side].reduce((a, id) => a + (items[id]?.value || 0), 0);

  function renderChips(side) {
    const box = $(side + "Slots");
    box.textContent = "";
    for (let idx = 0; idx < MAX_ITEMS; idx++) {
      const id = cfg[side][idx];
      const slot = document.createElement("div");
      if (id === undefined) {
        slot.className = "slot empty";
        slot.textContent = "Empty slot";
      } else {
        slot.className = "slot filled";
        const av = document.createElement("div"); av.className = "avatar"; av.textContent = initials(id);
        const meta = document.createElement("div"); meta.className = "meta";
        const nm = document.createElement("b"); nm.textContent = nameOf(id); nm.title = nameOf(id);
        const val = document.createElement("small"); val.textContent = items[id] ? fmt(items[id].value) : "";
        meta.append(nm, val);
        const x = document.createElement("button");
        x.type = "button"; x.className = "rm"; x.textContent = "×"; x.title = "Remove"; x.setAttribute("aria-label", "Remove " + nameOf(id));
        x.addEventListener("click", () => { cfg[side].splice(idx, 1); save(); renderAll(); });
        slot.append(av, meta, x);
      }
      box.append(slot);
    }
    $(side + "Count").textContent = `${cfg[side].length}/${MAX_ITEMS}`;
    $(side + "Total").textContent = fmt(sumSide(side));
  }

  function renderResults(side) {
    const q = $(side + "Search").value.trim().toLowerCase();
    const box = $(side + "Results");
    box.textContent = "";
    if (cfg[side].length >= MAX_ITEMS) {
      const h = document.createElement("div"); h.className = "hint"; h.textContent = "All 4 slots are full. Remove an item to add another.";
      if (q) box.append(h);
      return;
    }
    if (!q) return;
    if (!itemList.length) {
      const h = document.createElement("div"); h.className = "hint"; h.textContent = "Loading items…"; box.append(h); return;
    }
    const hits = itemList
      .filter(i => i.name.toLowerCase().includes(q) || (i.acronym && i.acronym.toLowerCase() === q))
      .sort((a, b) => {
        const as = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bs = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return as - bs || b.value - a.value;
      })
      .slice(0, 8);
    if (!hits.length) {
      const h = document.createElement("div"); h.className = "hint"; h.textContent = `No items match “${q}”.`; box.append(h);
    }
    hits.forEach(i => {
      const b = document.createElement("button");
      b.type = "button";
      const n = document.createElement("span"); n.textContent = i.name + (i.acronym ? ` (${i.acronym})` : "");
      const v = document.createElement("small"); v.textContent = fmt(i.value);
      b.append(n, v);
      b.addEventListener("click", () => {
        if (cfg[side].length >= MAX_ITEMS) return;
        cfg[side].push(Number(i.id));
        $(side + "Search").value = "";
        save(); renderAll();
      });
      box.append(b);
    });
  }

  function renderTags() {
    const box = $("tagBox");
    box.textContent = "";
    TAGS.forEach(t => {
      const b = document.createElement("button");
      b.type = "button";
      const on = cfg.tags.includes(t);
      b.className = on ? "on" : "";
      b.textContent = t;
      b.disabled = !on && cfg.tags.length >= MAX_TAGS;
      b.addEventListener("click", () => {
        cfg.tags = on ? cfg.tags.filter(x => x !== t) : [...cfg.tags, t];
        save(); renderAll();
      });
      box.append(b);
    });
    $("tagCount").textContent = `${cfg.tags.length}/${MAX_TAGS}`;
  }

  function renderPreview() {
    const box = $("adPreview");
    box.textContent = "";
    const col = (title, side) => {
      const c = document.createElement("div"); c.className = "col";
      const h = document.createElement("h4"); h.textContent = `${title} · ${fmt(sumSide(side))}`;
      c.append(h);
      if (!cfg[side].length) {
        const d = document.createElement("div"); d.className = "none"; d.textContent = side === "request" && cfg.tags.length ? "Tags only" : "Nothing yet"; c.append(d);
      }
      cfg[side].forEach(id => { const d = document.createElement("div"); d.textContent = nameOf(id); c.append(d); });
      return c;
    };
    const arrow = document.createElement("div"); arrow.className = "arrow"; arrow.textContent = "⇄";
    box.append(col("Offering", "offer"), arrow, col("Requesting", "request"));
    if (cfg.tags.length) {
      const row = document.createElement("div"); row.className = "tagrow";
      cfg.tags.forEach(t => { const sp = document.createElement("span"); sp.textContent = t; row.append(sp); });
      box.append(row);
    }
    const badge = $("diffBadge");
    const o = sumSide("offer"), r = sumSide("request");
    if (!cfg.offer.length || !cfg.request.length) { badge.textContent = ""; badge.className = "badge"; }
    else {
      const d = r - o, pct = o ? Math.round(Math.abs(d) / o * 100) : 0;
      if (d === 0) { badge.textContent = "Even trade"; badge.className = "badge even"; }
      else if (d > 0) { badge.textContent = `You ask +${fmt(d)} (${pct}%)`; badge.className = "badge loss"; }
      else { badge.textContent = `You add +${fmt(-d)} (${pct}%)`; badge.className = "badge win"; }
    }
  }

  function renderChecklist() {
    const steps = [
      ["Pick items to offer", cfg.offer.length > 0],
      ["Pick items or tags to request", cfg.request.length > 0 || cfg.tags.length > 0],
      ["Auto-post " + (cfg.enabled ? "on" : "off"), !!cfg.enabled]
    ];
    const box = $("adChecklist");
    box.textContent = "";
    steps.forEach(([t, done]) => {
      const d = document.createElement("span"); d.className = "step" + (done ? " done" : ""); d.textContent = t; box.append(d);
    });
    $("adEnabledText").textContent = cfg.enabled ? "On" : "Off";
    const ready = cfg.offer.length > 0 && (cfg.request.length > 0 || cfg.tags.length > 0);
    $("adPostNow").disabled = !ready;
    $("adPostNow").title = ready ? "" : "Add something to offer and something to request first.";
    $("adClear").disabled = !(cfg.offer.length || cfg.request.length || cfg.tags.length);
  }

  const PRESETS = [[15, "15 min"], [30, "30 min"], [60, "1 hour"], [120, "2 hours"], [360, "6 hours"]];
  function renderPresets() {
    const box = $("intervalPresets");
    box.textContent = "";
    PRESETS.forEach(([m, label]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label;
      b.className = cfg.intervalMin === m ? "on" : "";
      b.addEventListener("click", () => { cfg.intervalMin = m; $("adInterval").value = m; save(); renderPresets(); });
      box.append(b);
    });
  }

  function renderAll() {
    renderChips("offer"); renderChips("request");
    renderResults("offer"); renderResults("request");
    renderTags(); renderPreview(); renderChecklist();
    if (!$("invPanel").hidden) renderInventory();
  }

  function renderStatus(st) {
    const el = $("adStatus");
    if (!st || !st.at) { el.textContent = ""; el.className = "ad-status"; return; }
    const when = new Date(st.at).toLocaleTimeString();
    el.textContent = `${when} — ${st.message || (st.ok ? "OK" : "Failed")}`;
    el.className = "ad-status " + (st.ok ? "ok" : "err");
  }

  async function init() {
    const stored = await browser.storage.local.get([KEY, STATUS_KEY]);
    cfg = { ...DEFAULTS, ...(stored[KEY] || {}) };
    $("adEnabled").checked = !!cfg.enabled;
    $("adInterval").value = cfg.intervalMin;
    $("adPlayerId").value = cfg.playerId;
    renderPresets();
    renderStatus(stored[STATUS_KEY]);
    renderAll();
    await loadItems();
    renderAll();
  }

  function showTab(inv) {
    $("invPanel").hidden = !inv;
    $("offerSearchPanel").hidden = inv;
    $("tabInv").classList.toggle("on", inv);
    $("tabSearch").classList.toggle("on", !inv);
    if (inv && !inventory) loadInventory();
    if (!inv) $("offerSearch").focus();
  }
  $("tabInv").addEventListener("click", () => showTab(true));
  $("tabSearch").addEventListener("click", () => showTab(false));
  $("invFilter").addEventListener("input", renderInventory);

  $("offerSearch").addEventListener("input", () => renderResults("offer"));
  $("requestSearch").addEventListener("input", () => renderResults("request"));

  $("adEnabled").addEventListener("change", e => {
    if (e.target.checked && !cfg.offer.length) {
      e.target.checked = false;
      renderStatus({ at: Date.now(), ok: false, message: "Add at least one item to offer first." });
      return;
    }
    if (e.target.checked && !cfg.request.length && !cfg.tags.length) {
      e.target.checked = false;
      renderStatus({ at: Date.now(), ok: false, message: "Add a requested item or tag first." });
      return;
    }
    cfg.enabled = e.target.checked; save(); renderChecklist();
  });
  $("adInterval").addEventListener("change", e => {
    cfg.intervalMin = Math.min(1440, Math.max(15, Math.floor(Number(e.target.value)) || 20));
    e.target.value = cfg.intervalMin; save(); renderPresets();
  });
  $("adPlayerId").addEventListener("input", e => {
    cfg.playerId = e.target.value.replace(/\D/g, ""); save();
  });

  $("adClear").addEventListener("click", () => {
    if (!confirm("Clear the offer, request and tags for your trade ad?")) return;
    cfg.offer = []; cfg.request = []; cfg.tags = []; cfg.enabled = false; $("adEnabled").checked = false;
    save(); renderAll();
  });

  $("adPostNow").addEventListener("click", async () => {
    const btn = $("adPostNow");
    btn.disabled = true;
    clearTimeout(saveTimer);
    await browser.storage.local.set({ [KEY]: cfg }); // make sure latest edits are stored
    try {
      const res = await browser.runtime.sendMessage({ type: "postTradeAdNow" });
      renderStatus({ at: Date.now(), ok: !!res?.ok, message: res?.message });
    } catch (e) {
      renderStatus({ at: Date.now(), ok: false, message: e.message });
    }
    renderChecklist();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STATUS_KEY]) renderStatus(changes[STATUS_KEY].newValue);
  });

  init();
})();
