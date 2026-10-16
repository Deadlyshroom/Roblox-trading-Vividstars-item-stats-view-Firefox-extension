(() => {
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(Number(n) || 0).toLocaleString();
  const ROBUX_TAX = 0.7; // Roblox keeps 30% of Robux in trades; matches the trade-page indicator

  const state = {
    type: "completed",
    lists: {},      // type -> { trades: [], next: cursor|null, loaded: bool }
    items: null,    // Rolimon's item table (lazy)
    loading: false
  };

  async function loadItems() {
    if (state.items) return state.items;
    try {
      const res = await browser.runtime.sendMessage({ type: "getRolimonsItems" });
      state.items = res?.ok && res.items ? res.items : {};
    } catch (_) { state.items = {}; }
    return state.items;
  }

  // Same rule as the trade page: a positive set Value wins, otherwise RAP.
  function valueOf(asset) {
    const d = state.items?.[asset.assetId];
    if (d) {
      const v = Number(d[3]), rap = Number(d[2]);
      if (v > 0) return { value: v, known: true };
      if (rap > 0) return { value: rap, known: true };
    }
    const rap = Number(asset.recentAveragePrice);
    return rap > 0 ? { value: rap, known: false } : { value: 0, known: false };
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function ago(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(t).toLocaleDateString();
  }

  function statusClass(status) {
    const s = String(status || "").toLowerCase();
    if (s === "completed") return "ok";
    if (s === "declined" || s === "expired" || s === "countered") return "bad";
    return "";
  }

  function renderSide(title, offer) {
    const box = el("div", "hist-side");
    box.appendChild(el("div", "hist-side-title", title));
    let sum = 0, unknown = 0;
    for (const a of offer?.userAssets || []) {
      const { value, known } = valueOf(a);
      sum += value;
      if (!value) unknown++;
      const row = el("div", "hist-item");
      row.appendChild(el("span", "", a.name || `Item ${a.assetId}`));
      row.appendChild(el("small", "", value ? fmt(value) + (known ? "" : " (RAP)") : "no value"));
      box.appendChild(row);
    }
    const robux = Number(offer?.robux) || 0;
    if (robux) {
      const row = el("div", "hist-item");
      row.appendChild(el("span", "", "Robux"));
      row.appendChild(el("small", "", `R$ ${fmt(robux)}`));
      box.appendChild(row);
    }
    if (!(offer?.userAssets || []).length && !robux) box.appendChild(el("div", "hist-empty", "Nothing"));
    const net = sum + Math.floor(robux * ROBUX_TAX);
    box.appendChild(el("div", "hist-total", `Total ${fmt(net)}`));
    return { box, net, unknown };
  }

  async function renderDetail(body, trade) {
    body.textContent = "Loading…";
    try {
      const [res] = await Promise.all([
        browser.runtime.sendMessage({ type: "getTradeDetail", id: trade.id }),
        loadItems()
      ]);
      if (!res?.ok) throw new Error(res?.error || "Couldn't load that trade.");
      const offers = Array.isArray(res.trade?.offers) ? res.trade.offers : [];
      const partnerId = Number(trade.user?.id);
      const theirs = offers.find(o => Number(o?.user?.id) === partnerId) || offers[1];
      const mine = offers.find(o => o !== theirs) || offers[0];
      const a = renderSide("You gave", mine);
      const b = renderSide(`${trade.user?.name || "They"} gave`, theirs);
      body.textContent = "";
      const grid = el("div", "hist-grid");
      grid.append(a.box, b.box);
      body.appendChild(grid);
      const delta = b.net - a.net;
      const pct = a.net > 0 ? (delta / a.net) * 100 : null;
      const sign = delta > 0 ? "+" : "";
      const verdict = el("div", "hist-verdict " + (delta > 0 ? "win" : delta < 0 ? "loss" : ""),
        `${trade.status === "Completed" ? "Result" : "If completed"}: ${sign}${fmt(delta)}` +
        (pct != null ? ` (${sign}${pct.toFixed(1)}%)` : "") +
        (a.unknown || b.unknown ? " · some items have no value" : ""));
      body.appendChild(verdict);
    } catch (e) {
      body.textContent = "";
      body.appendChild(el("div", "hist-error", e.message));
    }
  }

  function renderTrade(t) {
    const wrap = el("div", "hist-trade");
    const head = el("button", "hist-head");
    head.type = "button";
    const who = el("span", "hist-who", t.user?.displayName && t.user.displayName !== t.user.name
      ? `${t.user.displayName} (@${t.user.name})` : `@${t.user?.name || "unknown"}`);
    const meta = el("span", "hist-meta");
    const badge = el("em", "hist-badge " + statusClass(t.status), t.status || (t.isActive ? "Open" : "Inactive"));
    meta.append(badge, document.createTextNode(" " + ago(t.created)));
    head.append(who, meta);
    const body = el("div", "hist-body");
    body.hidden = true;
    let loaded = false;
    head.addEventListener("click", () => {
      body.hidden = !body.hidden;
      if (!body.hidden && !loaded) { loaded = true; renderDetail(body, t); }
    });
    wrap.append(head, body);
    return wrap;
  }

  function render() {
    const list = $("histList");
    list.textContent = "";
    const data = state.lists[state.type];
    const q = $("histFilter").value.trim().toLowerCase().replace(/^@/, "");
    const rows = (data?.trades || []).filter(t => !q ||
      String(t.user?.name || "").toLowerCase().includes(q) ||
      String(t.user?.displayName || "").toLowerCase().includes(q));
    rows.forEach(t => list.appendChild(renderTrade(t)));
    $("histMore").hidden = !data?.next;
    $("histMore").disabled = state.loading;
    if (state.loading) return;
    if (data?.loaded && !rows.length) {
      $("histStatus").textContent = q ? "No loaded trades match that name. Try loading more." : "No trades here.";
    }
  }

  async function load(more) {
    const type = state.type;
    const data = state.lists[type] || (state.lists[type] = { trades: [], next: null, loaded: false });
    if (state.loading) return;
    state.loading = true;
    $("histStatus").textContent = "Loading…";
    render();
    try {
      const res = await browser.runtime.sendMessage({ type: "getTradeHistory", tradeType: type, cursor: more ? data.next : null });
      if (!res?.ok) throw new Error(res?.error || "Couldn't load trade history.");
      if (!more) data.trades = [];
      data.trades.push(...res.trades);
      data.next = res.next;
      data.loaded = true;
      $("histStatus").textContent = data.trades.length ? `${data.trades.length} loaded` : "";
    } catch (e) {
      $("histStatus").textContent = e.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  function setType(type) {
    state.type = type;
    document.querySelectorAll("#histTypes .tab").forEach(b => b.classList.toggle("on", b.dataset.type === type));
    $("histStatus").textContent = "";
    const data = state.lists[type];
    if (data?.loaded) { $("histStatus").textContent = `${data.trades.length} loaded`; render(); }
    else load(false);
  }

  document.querySelectorAll("#histTypes .tab").forEach(b => b.addEventListener("click", () => setType(b.dataset.type)));
  $("histFilter").addEventListener("input", render);
  $("histMore").addEventListener("click", () => load(true));

  // Load lazily the first time the History tab is opened.
  let started = false;
  function maybeStart() {
    if (started || $("histList").closest(".panel").hidden) return;
    started = true;
    setType(state.type);
  }
  const panel = $("histList").closest(".panel");
  new MutationObserver(maybeStart).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  maybeStart();
})();
