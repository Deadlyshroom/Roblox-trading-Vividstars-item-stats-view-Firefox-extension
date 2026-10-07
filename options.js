const NOTIFY_DEFAULTS = { inboundEnabled: false, declinedEnabled: false, completedEnabled: false, inboundSound: false };

const DEFAULTS = {
  valueText: "#00a2ff",
  valueBackground: "#ebf7ff",
  valueBorder: "#b8ddf2",
  totalText: "#00a2ff",
  totalBackground: "#e9f7ff",
  totalBorder: "#b4d9ef"
};

const ids = Object.keys(DEFAULTS);

const RU_DEFAULTS = { label: "USD", showLabel: true, currency: "$", decimals: 2, text: "#8f98a5", background: "#8f98a5", border: "#8f98a5" };
const RU_FIELDS = { label: "ruLabel", showLabel: "ruShowLabel", currency: "ruCurrency", decimals: "ruDecimals", text: "ruText", background: "ruBackground", border: "ruBorder" };

function readRoutility() {
  const g = id => document.getElementById(id);
  return {
    label: g("ruLabel").value.trim().slice(0, 8) || RU_DEFAULTS.label,
    showLabel: g("ruShowLabel").checked,
    currency: g("ruCurrency").value,
    decimals: Number(g("ruDecimals").value),
    text: g("ruText").value,
    background: g("ruBackground").value,
    border: g("ruBorder").value
  };
}

function updateRoutilityPreview(c) {
  const box = document.getElementById("ruPreview");
  box.style.setProperty("--ru-text", c.text);
  box.style.setProperty("--ru-bg", hexToRgba(c.background, 0.08));
  box.style.setProperty("--ru-border", hexToRgba(c.border, 0.35));
  const lab = document.getElementById("ruPreviewLabel");
  lab.textContent = c.label;
  lab.style.display = c.showLabel ? "" : "none";
  const sym = c.currency === "none" ? "" : c.currency;
  document.getElementById("ruPreviewNumber").textContent = sym + (12.5).toFixed(c.decimals);
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const n = Number.parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

async function load() {
  const stored = await browser.storage.local.get(["rolimonsColors", "routilityEnabled", "routilityStatsEnabled", "rolimonsTradeNotifications", "tradeWinLossEnabled", "profileValuesEnabled", "graphButtonEnabled", "routilitySettings"]);
  const colors = { ...DEFAULTS, ...(stored.rolimonsColors || {}) };
  ids.forEach(id => document.getElementById(id).value = colors[id]);
  updatePreview(colors);
  document.getElementById("routilityEnabled").checked = !!stored.routilityEnabled;
  document.getElementById("routilityStatsEnabled").checked = !!stored.routilityStatsEnabled;
  const ru = { ...RU_DEFAULTS, ...(stored.routilitySettings || {}) };
  for (const [k, id] of Object.entries(RU_FIELDS)) {
    const el = document.getElementById(id);
    if (el.type === "checkbox") el.checked = !!ru[k]; else el.value = String(ru[k]);
  }
  updateRoutilityPreview(ru);
  document.getElementById("tradeWinLossEnabled").checked = stored.tradeWinLossEnabled !== false; // on by default
  document.getElementById("profileValuesEnabled").checked = !!stored.profileValuesEnabled; // off by default
  document.getElementById("graphButtonEnabled").checked = !!stored.graphButtonEnabled; // off by default
  const notify = { ...NOTIFY_DEFAULTS, ...(stored.rolimonsTradeNotifications || {}) };
  document.getElementById("inboundEnabled").checked = !!notify.inboundEnabled;
  document.getElementById("declinedEnabled").checked = !!notify.declinedEnabled;
  document.getElementById("completedEnabled").checked = !!notify.completedEnabled;
  document.getElementById("inboundSound").checked = !!notify.inboundSound;
}

function read() {
  return Object.fromEntries(ids.map(id => [id, document.getElementById(id).value]));
}

function updatePreview(c) {
  const root = document.documentElement;
  root.style.setProperty("--preview-text", c.valueText);
  root.style.setProperty("--preview-bg", hexToRgba(c.valueBackground, 0.08));
  root.style.setProperty("--preview-border", c.valueBorder);
  document.querySelector(".preview-total").style.setProperty("--preview-text", c.totalText);
  document.querySelector(".preview-total").style.setProperty("--preview-bg", hexToRgba(c.totalBackground, 0.09));
  document.querySelector(".preview-total").style.setProperty("--preview-border", c.totalBorder);
}

async function save() {
  const colors = read();
  const notifications = {
    inboundEnabled: document.getElementById("inboundEnabled").checked,
    declinedEnabled: document.getElementById("declinedEnabled").checked,
    completedEnabled: document.getElementById("completedEnabled").checked,
    inboundSound: document.getElementById("inboundSound").checked
  };
  await browser.storage.local.set({
    rolimonsColors: colors,
    routilityEnabled: document.getElementById("routilityEnabled").checked,
    routilityStatsEnabled: document.getElementById("routilityStatsEnabled").checked,
    tradeWinLossEnabled: document.getElementById("tradeWinLossEnabled").checked,
    profileValuesEnabled: document.getElementById("profileValuesEnabled").checked,
    graphButtonEnabled: document.getElementById("graphButtonEnabled").checked,
    rolimonsTradeNotifications: notifications,
    routilitySettings: readRoutility()
  });
  updatePreview(colors);
  updateRoutilityPreview(readRoutility());
  document.getElementById("saved").textContent = "Saved";
  clearTimeout(save.timer);
  save.timer = setTimeout(() => document.getElementById("saved").textContent = "Saved automatically", 1000);
}

ids.forEach(id => document.getElementById(id).addEventListener("input", save));
document.getElementById("routilityEnabled").addEventListener("change", save);
document.getElementById("routilityStatsEnabled").addEventListener("change", save);
document.getElementById("tradeWinLossEnabled").addEventListener("change", save);
document.getElementById("profileValuesEnabled").addEventListener("change", save);
document.getElementById("graphButtonEnabled").addEventListener("change", save);
document.getElementById("inboundEnabled").addEventListener("change", save);
document.getElementById("declinedEnabled").addEventListener("change", save);
document.getElementById("completedEnabled").addEventListener("change", save);
document.getElementById("inboundSound").addEventListener("change", save);
Object.values(RU_FIELDS).forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener(el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input", save);
});
document.getElementById("reset").addEventListener("click", async () => {
  ids.forEach(id => document.getElementById(id).value = DEFAULTS[id]);
  for (const [k, id] of Object.entries(RU_FIELDS)) {
    const el = document.getElementById(id);
    if (el.type === "checkbox") el.checked = !!RU_DEFAULTS[k]; else el.value = String(RU_DEFAULTS[k]);
  }
  await save();
});

load();

// Keep this page in sync when settings are changed from the toolbar popup.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || document.hasFocus()) return;
  if (["routilityEnabled", "routilityStatsEnabled", "tradeWinLossEnabled", "profileValuesEnabled", "graphButtonEnabled", "routilitySettings", "rolimonsTradeNotifications"].some(k => changes[k])) load();
});
