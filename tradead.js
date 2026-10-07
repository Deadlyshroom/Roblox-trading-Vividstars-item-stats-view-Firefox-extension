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
      ? `${rows.length} item${rows.length === 1 ? "" : "s"} · click to add, click again to remove`
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

  function renderChips(side) {
    const box = $(side + "Chips");
    box.textContent = "";
    cfg[side].forEach((id, idx) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const label = document.createElement("span");
      label.textContent = nameOf(id);
      const small = document.createElement("small");
      small.textContent = items[id] ? fmt(items[id].value) : "";
      const x = document.createElement("button");
      x.type = "button"; x.textContent = "×"; x.title = "Remove";
      x.addEventListener("click", () => { cfg[side].splice(idx, 1); save(); renderAll(); });
      chip.append(label, small, x);
      box.append(chip);
    });
    $(side + "Count").textContent = `${cfg[side].length}/${MAX_ITEMS}`;
  }

  function renderResults(side) {
    const q = $(side + "Search").value.trim().toLowerCase();
    const box = $(side + "Results");
    box.textContent = "";
    if (!q || cfg[side].length >= MAX_ITEMS) return;
    const hits = itemList
      .filter(i => i.name.toLowerCase().includes(q) || (i.acronym && i.acronym.toLowerCase() === q))
      .sort((a, b) => {
        const as = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bs = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return as - bs || b.value - a.value;
      })
      .slice(0, 8);
    hits.forEach(i => {
      const b = document.createElement("button");
      b.type = "button";
      const n = document.createElement("span"); n.textContent = i.name;
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
    const sum = side => cfg[side].reduce((a, id) => a + (items[id]?.value || 0), 0);
    const list = side => cfg[side].length ? cfg[side].map(nameOf).join(", ") : "—";
    const tags = cfg.tags.length ? cfg.tags.join(", ") : "—";
    const box = $("adPreview");
    box.textContent = "";
    const rows = [
      ["Offer", `${list("offer")} (${fmt(sum("offer"))})`],
      ["Request", `${list("request")} (${fmt(sum("request"))})`],
      ["Tags", tags]
    ];
    rows.forEach(([k, v]) => {
      const d = document.createElement("div");
      const b = document.createElement("strong"); b.textContent = k + ": ";
      d.append(b, document.createTextNode(v));
      box.append(d);
    });
  }

  function renderAll() {
    renderChips("offer"); renderChips("request");
    renderResults("offer"); renderResults("request");
    renderTags(); renderPreview();
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
    renderStatus(stored[STATUS_KEY]);
    renderAll();
    await loadItems();
    renderAll();
  }

  $("invToggle").addEventListener("click", () => {
    const panel = $("invPanel");
    panel.hidden = !panel.hidden;
    $("invToggle").textContent = panel.hidden ? "Choose from my inventory" : "Hide my inventory";
    if (!panel.hidden && !inventory) loadInventory();
  });
  $("invFilter").addEventListener("input", renderInventory);

  $("offerSearch").addEventListener("input", () => renderResults("offer"));
  $("requestSearch").addEventListener("input", () => renderResults("request"));

  $("adEnabled").addEventListener("change", e => {
    if (e.target.checked && !cfg.offer.length) {
      e.target.checked = false;
      renderStatus({ at: Date.now(), ok: false, message: "Add at least one item to offer first." });
      return;
    }
    cfg.enabled = e.target.checked; save();
  });
  $("adInterval").addEventListener("change", e => {
    cfg.intervalMin = Math.min(1440, Math.max(15, Math.floor(Number(e.target.value)) || 20));
    e.target.value = cfg.intervalMin; save();
  });
  $("adPlayerId").addEventListener("input", e => {
    cfg.playerId = e.target.value.replace(/\D/g, ""); save();
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
    btn.disabled = false;
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STATUS_KEY]) renderStatus(changes[STATUS_KEY].newValue);
  });

  init();
})();
