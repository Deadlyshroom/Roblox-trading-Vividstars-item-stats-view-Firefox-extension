(() => {
  const KEY = "valueAlerts", LOG = "valueAlertLog";
  const STATS = ["value", "rap", "demand", "trend", "projected", "rare"];
  const LABEL = { value: "Value", rap: "RAP", demand: "Demand", trend: "Trend", projected: "Projected", rare: "Rare" };
  const D = { enabled: false, intervalMin: 5, direction: "any", minPercent: 0, notify: true, watch: [], defaults: { value: true, rap: false, demand: true, trend: true, projected: false, rare: false } };
  const $ = id => document.getElementById(id);
  let cfg = { ...D };
  let items = null;

  const save = () => {
    cfg.enabled = $("vaEnabled").checked;
    cfg.notify = $("vaNotify").checked;
    cfg.intervalMin = Number($("vaInterval").value) || 5;
    cfg.direction = $("vaDirection").value;
    const n = parseFloat($("vaMinPercent").value); cfg.minPercent = Number.isFinite(n) && n > 0 ? n : 0;
    STATS.forEach(k => cfg.defaults[k] = $("vaDef_" + k).checked);
    return browser.storage.local.set({ [KEY]: cfg });
  };

  function renderWatch() {
    const box = $("vaWatchList"); box.textContent = "";
    if (!cfg.watch.length) { box.textContent = "No items yet. Search above to add one."; return; }
    cfg.watch.forEach((w, i) => {
      const row = document.createElement("div"); row.className = "aditem";
      const left = document.createElement("div");
      const t = document.createElement("span"); t.textContent = w.name || w.id;
      const sm = document.createElement("small"); sm.textContent = ` (ID ${w.id})`; t.append(sm);
      const chips = document.createElement("div"); chips.className = "va-stats";
      STATS.forEach(k => {
        const b = document.createElement("button"); b.type = "button";
        b.className = "va-stat" + (w.stats?.[k] ? " on" : ""); b.textContent = LABEL[k];
        b.addEventListener("click", () => { w.stats = { ...(w.stats || {}), [k]: !w.stats?.[k] }; b.classList.toggle("on", w.stats[k]); save(); });
        chips.append(b);
      });
      left.append(t, chips);
      const x = document.createElement("button"); x.type = "button"; x.className = "secondary"; x.textContent = "Remove";
      x.addEventListener("click", () => { cfg.watch.splice(i, 1); save(); renderWatch(); renderInv(); });
      row.append(left, x); box.append(row);
    });
  }

  function renderLog(log) {
    const box = $("vaLog"); box.textContent = "";
    if (!log.length) { box.textContent = "Nothing yet."; return; }
    log.slice(0, 30).forEach(e => {
      const row = document.createElement("div"); row.className = "aditem";
      const d = document.createElement("div");
      d.textContent = `${new Date(e.t).toLocaleString()} · ${e.name}`;
      (e.lines || []).forEach(l => { const s = document.createElement("span"); s.className = "va-line"; s.textContent = l; d.append(s); });
      row.append(d); box.append(row);
    });
  }

  async function loadItems() {
    if (items) return items;
    const r = await browser.runtime.sendMessage({ type: "getRolimonsItems" }).catch(() => null);
    if (!r?.ok) throw new Error(r?.error || "Couldn't load Rolimon's items");
    items = r.items?.items || r.items || {};
    return items;
  }

  async function search() {
    const q = $("vaSearch").value.trim().toLowerCase(), box = $("vaResults"), st = $("vaStatus");
    box.textContent = ""; st.textContent = "";
    if (q.length < 2) return;
    try {
      const all = await loadItems();
      const hits = [];
      for (const [id, d] of Object.entries(all)) {
        if (!Array.isArray(d)) continue;
        if (id === q || String(d[0]).toLowerCase().includes(q) || String(d[1] || "").toLowerCase() === q) hits.push([id, d]);
        if (hits.length >= 8) break;
      }
      if (!hits.length) { st.textContent = "No items found."; return; }
      hits.forEach(([id, d]) => {
        const row = document.createElement("div"); row.className = "aditem";
        const b = document.createElement("button"); b.type = "button"; b.className = "va-pick";
        b.textContent = d[0]; const sm = document.createElement("small"); sm.textContent = ` ${d[1] ? "(" + d[1] + ") " : ""}ID ${id}`; b.append(sm);
        b.addEventListener("click", () => add(id, d[0]));
        row.append(b); box.append(row);
      });
    } catch (e) { st.textContent = e.message; }
  }

  async function add(id, name) {
    if (cfg.watch.some(w => String(w.id) === String(id))) { $("vaStatus").textContent = "Already watching that item."; return; }
    cfg.watch.push({ id: String(id), name, stats: { ...cfg.defaults } });
    $("vaSearch").value = ""; $("vaResults").textContent = "";
    $("vaStatus").textContent = "Added " + name;
    await save(); renderWatch(); renderInv();
    browser.runtime.sendMessage({ type: "valueAlertsCheckNow" }).catch(() => {}); // records the starting point
  }

  let inv = null; // [{id, name, count, value}]

  function renderInv() {
    const box = $("vaInvList"); box.textContent = "";
    if (!inv) return;
    const q = $("vaInvFilter").value.trim().toLowerCase();
    const rows = inv.filter(r => !q || r.name.toLowerCase().includes(q));
    if (!rows.length) { box.textContent = inv.length ? "No matches." : "No limiteds found in this inventory."; return; }
    rows.forEach(r => {
      const row = document.createElement("div"); row.className = "aditem";
      const t = document.createElement("span"); t.textContent = r.name;
      const sm = document.createElement("small"); sm.textContent = ` ×${r.count} · ${Number(r.value).toLocaleString("en-US")}`; t.append(sm);
      const watching = cfg.watch.some(w => String(w.id) === String(r.id));
      const b = document.createElement("button"); b.type = "button"; b.className = "secondary";
      b.textContent = watching ? "Watching" : "Watch"; b.disabled = watching;
      b.addEventListener("click", () => add(r.id, r.name));
      row.append(t, b); box.append(row);
    });
  }

  async function loadInventory() {
    const st = $("vaInvStatus"); st.textContent = "Loading…";
    try {
      const [res, all] = await Promise.all([
        browser.runtime.sendMessage({ type: "getMyInventory" }),
        loadItems()
      ]);
      if (!res?.ok) throw new Error(res?.error || "Couldn't load your inventory.");
      inv = Object.entries(res.assets).map(([id, count]) => {
        const d = all[id];
        const rap = Number(d?.[2]) > 0 ? Number(d[2]) : 0;
        const set = Number(d?.[3]);
        return { id, name: d?.[0] || `Item ${id}`, count, value: set > 0 ? set : rap, known: Array.isArray(d) };
      }).filter(r => r.known).sort((a, b) => b.value - a.value);
      st.textContent = `${inv.length} item(s) found.`;
      $("vaInvFilter").hidden = false;
      renderInv();
    } catch (e) { st.textContent = e.message; }
  }

  async function load() {
    const s = await browser.storage.local.get([KEY, LOG]);
    cfg = { ...D, ...(s[KEY] || {}), defaults: { ...D.defaults, ...(s[KEY]?.defaults || {}) }, watch: s[KEY]?.watch || [] };
    $("vaEnabled").checked = cfg.enabled; $("vaNotify").checked = cfg.notify;
    $("vaInterval").value = String(cfg.intervalMin); $("vaDirection").value = cfg.direction;
    $("vaMinPercent").value = cfg.minPercent;
    STATS.forEach(k => $("vaDef_" + k).checked = !!cfg.defaults[k]);
    renderWatch(); renderLog(s[LOG] || []);
  }

  ["vaEnabled", "vaNotify", "vaInterval", "vaDirection"].forEach(id => $(id).addEventListener("change", save));
  $("vaMinPercent").addEventListener("input", save);
  STATS.forEach(k => $("vaDef_" + k).addEventListener("change", save));
  $("vaSearch").addEventListener("input", search);
  let invOpen = false;
  function setInvOpen(open) {
    invOpen = open;
    $("vaInvList").hidden = !open; $("vaInvFilter").hidden = !open || !inv;
    $("vaInvLoad").textContent = open ? "Hide my inventory" : "Show my inventory";
    if (!open) $("vaInvStatus").textContent = "";
  }
  $("vaInvLoad").addEventListener("click", async () => {
    if (invOpen) return setInvOpen(false);
    if (!inv) await loadInventory(); else renderInv();
    if (inv) setInvOpen(true);
  });
  $("vaInvFilter").addEventListener("input", renderInv);
  $("vaApplyAll").addEventListener("click", async () => {
    cfg.watch.forEach(w => w.stats = { ...cfg.defaults });
    await save(); renderWatch(); $("vaApplyStatus").textContent = "Applied.";
  });
  $("vaClearLog").addEventListener("click", async () => { await browser.storage.local.set({ [LOG]: [] }); renderLog([]); });
  $("vaCheckNow").addEventListener("click", async () => {
    const st = $("vaCheckStatus"); st.textContent = "Checking…";
    const r = await browser.runtime.sendMessage({ type: "valueAlertsCheckNow" }).catch(() => null);
    st.textContent = !r ? "No response." : r.ok ? (r.busy ? "Already checking." : `Done. ${r.alerts || 0} alert(s).`) : "Error: " + r.error;
  });
  browser.storage.onChanged.addListener((c, a) => { if (a === "local" && c[LOG]) renderLog(c[LOG].newValue || []); });
  load();
})();
