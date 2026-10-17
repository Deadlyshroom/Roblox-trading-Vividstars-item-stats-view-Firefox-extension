const RU_DEFAULTS = { label: "USD", showLabel: true, currency: "$", decimals: 2, text: "#8f98a5", background: "#8f98a5", border: "#8f98a5" };
const NOTIFY_DEFAULTS = { inboundEnabled: false, declinedEnabled: false, completedEnabled: false, inboundSound: false };
const DEFAULT_PINNED = ["routilityEnabled", "routilityStatsEnabled", "graphButtonEnabled", "tradeWinLossEnabled"];

// key = storage key. sub = field inside an object-valued setting.
const SETTINGS = [
  { id: "routilityEnabled", group: "Values", label: "RoUtility USD on items", type: "toggle", key: "routilityEnabled", def: false },
  { id: "routilityStatsEnabled", group: "Values", label: "RoUtility stats in Stats popup", type: "toggle", key: "routilityStatsEnabled", def: false },
  { id: "graphButtonEnabled", group: "Values", label: "Graph button on items", type: "toggle", key: "graphButtonEnabled", def: false },
  { id: "tradeWinLossEnabled", group: "Values", label: "Win / Loss indicators", type: "toggle", key: "tradeWinLossEnabled", def: true },
  { id: "profileValuesEnabled", group: "Values", label: "Values on profiles & inventories", type: "toggle", key: "profileValuesEnabled", def: false },
  { id: "ruShowLabel", group: "RoUtility look", label: "Show the USD label", type: "toggle", key: "routilitySettings", sub: "showLabel", defs: RU_DEFAULTS },
  { id: "ruCurrency", group: "RoUtility look", label: "Currency symbol", type: "select", key: "routilitySettings", sub: "currency", defs: RU_DEFAULTS,
    options: [["$", "$ dollar"], ["€", "€ euro"], ["£", "£ pound"], ["none", "None"]] },
  { id: "ruDecimals", group: "RoUtility look", label: "Decimal places", type: "select", key: "routilitySettings", sub: "decimals", defs: RU_DEFAULTS, number: true,
    options: [["0", "0"], ["1", "1"], ["2", "2"]] },
  { id: "adEnabled", group: "Trade ads", label: "Auto-post my trade ad", type: "toggle", key: "tradeAdSettings", sub: "enabled", defs: {}, special: "ad" },
  { id: "inboundEnabled", group: "Notifications", label: "Inbound trades", type: "toggle", key: "rolimonsTradeNotifications", sub: "inboundEnabled", defs: NOTIFY_DEFAULTS },
  { id: "declinedEnabled", group: "Notifications", label: "Declined trades", type: "toggle", key: "rolimonsTradeNotifications", sub: "declinedEnabled", defs: NOTIFY_DEFAULTS },
  { id: "completedEnabled", group: "Notifications", label: "Completed trades", type: "toggle", key: "rolimonsTradeNotifications", sub: "completedEnabled", defs: NOTIFY_DEFAULTS },
  { id: "inboundSound", group: "Notifications", label: "Notification sound", type: "toggle", key: "rolimonsTradeNotifications", sub: "inboundSound", defs: NOTIFY_DEFAULTS }
];

const $ = (id) => document.getElementById(id);
let store = {};
let pinned = [...DEFAULT_PINNED];
let editing = false;

function getValue(s) {
  if (!s.sub) return store[s.key] === undefined ? s.def : store[s.key];
  const obj = { ...(s.defs || {}), ...(store[s.key] || {}) };
  return obj[s.sub];
}

async function setValue(s, value) {
  if (!s.sub) {
    store[s.key] = value;
    await browser.storage.local.set({ [s.key]: value });
    return;
  }
  const next = { ...(s.defs || {}), ...(store[s.key] || {}), [s.sub]: value };
  store[s.key] = next;
  await browser.storage.local.set({ [s.key]: next });
}

function flash(text) {
  $("msg").textContent = text;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { $("msg").textContent = ""; }, 2200);
}

function control(s) {
  if (s.type === "select") {
    const sel = document.createElement("select");
    for (const [v, label] of s.options) {
      const o = document.createElement("option");
      o.value = v; o.textContent = label; sel.appendChild(o);
    }
    sel.value = String(getValue(s));
    sel.addEventListener("change", async () => {
      await setValue(s, s.number ? Number(sel.value) : sel.value);
      flash("Saved");
    });
    return sel;
  }
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!getValue(s);
  cb.addEventListener("change", async () => {
    if (s.special === "ad" && cb.checked) {
      const offer = store.tradeAdSettings?.offer;
      if (!Array.isArray(offer) || !offer.length) {
        cb.checked = false;
        flash("Add an item to offer in All settings first.");
        return;
      }
    }
    await setValue(s, cb.checked);
    flash("Saved");
  });
  return cb;
}

function render() {
  const list = $("list");
  list.textContent = "";
  $("editPins").textContent = editing ? "Done" : "Edit pins";
  $("editPins").classList.toggle("active", editing);

  const hint = $("hint");
  hint.hidden = !editing;
  hint.textContent = "Tap the pin next to a setting to show or hide it in this popup.";

  const shown = SETTINGS.filter(s => editing || pinned.includes(s.id));
  if (!shown.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Nothing pinned yet. Tap “Edit pins” to choose the settings you want here.";
    list.appendChild(e);
    return;
  }

  let lastGroup = null;
  for (const s of shown) {
    if (editing && s.group !== lastGroup) {
      const g = document.createElement("div");
      g.className = "group"; g.textContent = s.group;
      list.appendChild(g);
      lastGroup = s.group;
    }
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("label");
    label.textContent = s.label;
    const ctl = control(s);
    ctl.id = "ctl-" + s.id;
    label.htmlFor = ctl.id;
    row.append(label, ctl);

    if (editing) {
      const pin = document.createElement("button");
      pin.type = "button";
      const on = pinned.includes(s.id);
      pin.className = "pin" + (on ? " on" : "");
      pin.textContent = "📌";
      pin.title = on ? "Unpin from this popup" : "Pin to this popup";
      pin.setAttribute("aria-pressed", String(on));
      pin.addEventListener("click", async () => {
        pinned = pinned.includes(s.id) ? pinned.filter(x => x !== s.id) : [...pinned, s.id];
        await browser.storage.local.set({ popupPinned: pinned });
        render();
      });
      row.appendChild(pin);
    }
    list.appendChild(row);
  }
}

async function init() {
  const keys = [...new Set(SETTINGS.map(s => s.key)), "popupPinned"];
  store = await browser.storage.local.get(keys);
  if (Array.isArray(store.popupPinned)) pinned = store.popupPinned;
  render();
}

$("editPins").addEventListener("click", () => { editing = !editing; render(); });
$("openOptions").addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

init();
