(() => {
  const tabs = [...document.querySelectorAll(".navtab")];
  const panels = [...document.querySelectorAll(".panel")];
  function show(name) {
    if (!panels.some(p => p.dataset.panel === name)) name = "appearance";
    tabs.forEach(t => { const on = t.dataset.tab === name; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); });
    panels.forEach(p => p.hidden = p.dataset.panel !== name);
    try { history.replaceState(null, "", "#" + name); } catch (_) {}
  }
  tabs.forEach(t => t.addEventListener("click", () => show(t.dataset.tab)));
  show(location.hash.slice(1));
})();
