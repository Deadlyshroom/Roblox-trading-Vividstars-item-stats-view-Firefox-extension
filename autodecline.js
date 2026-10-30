(() => {
  const KEY = "autoDeclineSettings", LOG = "autoDeclineLog";
  const $ = id => document.getElementById(id);
  const D = { enabled: false, notify: true, percentEnabled: false, minPercent: 0, demandLevel: "off", declineProjected: false, declineLowering: false, declineRobuxAsk: false, blacklist: [] };
  const checks = { adEnabled: "enabled", adNotify: "notify", adPercentEnabled: "percentEnabled", adProjected: "declineProjected", adLowering: "declineLowering", adRobuxAsk: "declineRobuxAsk" };
  let cfg = { ...D };

  function renderList() {
    const box = $("adBlackList"); box.textContent = "";
    cfg.blacklist.forEach((b, i) => {
      const row = document.createElement("div"); row.className = "aditem";
      const t = document.createElement("span"); t.textContent = b.name || b.id; const sm = document.createElement("small"); sm.textContent = ` (ID ${b.id})`; t.append(sm);
      const x = document.createElement("button"); x.type = "button"; x.className = "secondary"; x.textContent = "Remove";
      x.addEventListener("click", () => { cfg.blacklist.splice(i, 1); save(); renderList(); });
      row.append(t, x); box.append(row);
    });
  }
  function renderLog(log) {
    const box = $("adLog"); box.textContent = "";
    if (!log.length) { box.textContent = "Nothing yet."; return; }
    log.slice(0, 20).forEach(e => {
      const row = document.createElement("div"); row.className = "aditem";
      row.textContent = `${new Date(e.t).toLocaleString()} · ${e.user}: ${e.reason}`;
      box.append(row);
    });
  }
  function fill() {
    for (const [id, k] of Object.entries(checks)) $(id).checked = !!cfg[k];
    $("adMinPercent").value = cfg.minPercent === "" ? "" : cfg.minPercent; $("adDemand").value = String(cfg.demandLevel);
    renderList();
  }
  function save() {
    for (const [id, k] of Object.entries(checks)) cfg[k] = $(id).checked;
    const n = parseFloat($("adMinPercent").value); cfg.minPercent = Number.isFinite(n) ? n : "";
    cfg.demandLevel = $("adDemand").value;
    return browser.storage.local.set({ [KEY]: cfg });
  }
  async function load() {
    const s = await browser.storage.local.get([KEY, LOG]);
    cfg = { ...D, ...(s[KEY] || {}), blacklist: s[KEY]?.blacklist || [] };
    fill(); renderLog(s[LOG] || []);
  }
  async function addBlack() {
    const v = $("adBlackInput").value.trim(), st = $("adBlackStatus");
    if (!v) return;
    st.textContent = "Looking up…";
    try {
      let user;
      if (/^\d+$/.test(v)) {
        const r = await fetch(`https://users.roblox.com/v1/users/${v}`); if (!r.ok) throw 0; user = await r.json();
      } else {
        const r = await fetch("https://users.roblox.com/v1/usernames/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usernames: [v], excludeBannedUsers: false }) });
        user = (await r.json())?.data?.[0]; if (!user) throw 0;
      }
      if (!cfg.blacklist.some(b => String(b.id) === String(user.id))) cfg.blacklist.push({ id: String(user.id), name: user.name });
      $("adBlackInput").value = ""; st.textContent = "Added " + user.name; await save(); renderList();
    } catch (_) { st.textContent = "Couldn't find that player."; }
  }
  Object.keys(checks).forEach(id => $(id).addEventListener("change", save));
  $("adMinPercent").addEventListener("input", save);
  $("adDemand").addEventListener("change", save);
  $("adBlackAdd").addEventListener("click", addBlack);
  $("adBlackInput").addEventListener("keydown", e => { if (e.key === "Enter") addBlack(); });
  $("adClearLog").addEventListener("click", async () => { await browser.storage.local.set({ [LOG]: [] }); renderLog([]); });
  $("adCheckNow").addEventListener("click", async () => {
    const st = $("adCheckStatus"); st.textContent = "Checking…";
    const r = await browser.runtime.sendMessage({ type: "autoDeclineCheckNow" }).catch(() => null);
    st.textContent = !r ? "No response." : r.ok ? `Done. ${r.declined || 0} matched.` : r.busy ? "Already checking." : "Error: " + (r.error || "failed");
    load();
  });
  browser.storage.onChanged.addListener((c, a) => { if (a === "local" && c[LOG]) renderLog(c[LOG].newValue || []); });
  load();
})();
