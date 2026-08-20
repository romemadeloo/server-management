const CanyoneeringPlan = (() => {
  const STORAGE_KEY = "serverManager.canyoneeringPlan";
  const steps = [
    ["06:30", "Meet the operator", "Transfer to Badian and confirm the river conditions."],
    ["08:00", "Safety briefing", "Fit your helmet and life vest; follow the local guide's route."],
    ["08:30", "River adventure", "Keep the group together and use only approved jumps and slides."],
    ["12:00", "Kawasan Falls", "Take a break, eat lunch, and stay with the guide near the falls."],
    ["15:00", "Return and reset", "Change into dry clothes, hydrate, and check the return transfer."]
  ];
  const essentials = ["Water shoes with a secure fit", "Dry bag and waterproof phone case", "Rash guard or quick-dry clothes", "Water, snacks, ID, and cash"];

  function checked() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch (err) { return []; }
  }

  function save(values) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (err) { /* checklist persistence is optional */ }
  }

  function render(host) {
    if (!host) return;
    const done = checked();
    host.innerHTML = `<div class="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line">
      <div class="flex flex-wrap items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
        <div><p class="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-fg">Weekend plan</p><h2 class="mt-1 text-[17px] font-bold tracking-tight">Canyoneering in Cebu</h2><p class="mt-1 text-xs text-faint">Badian · Kawasan Falls · Confirm the operator schedule before leaving.</p></div>
        <span class="rounded-full bg-brand-soft px-3 py-1.5 text-[11px] font-bold text-brand-fg" data-plan-progress>${done.length}/${essentials.length} packed</span>
      </div>
      <div class="grid gap-5 p-5 lg:grid-cols-[1.25fr_1fr]">
        <div><p class="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Suggested day</p><div class="space-y-3">
          ${steps.map(([time, title, detail]) => `<div class="flex gap-3"><span class="w-12 shrink-0 pt-0.5 text-[10px] font-bold text-brand-fg">${H.esc(time)}</span><div class="min-w-0 border-l border-brand-200 pl-3"><p class="text-xs font-bold text-ink-2">${H.esc(title)}</p><p class="mt-0.5 text-[11px] leading-relaxed text-faint">${H.esc(detail)}</p></div></div>`).join("")}
        </div></div>
        <div><p class="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">Pack checklist</p><div class="space-y-2">
          ${essentials.map((item, index) => `<label class="flex cursor-pointer items-start gap-2.5 rounded-xl bg-subtle px-3 py-2.5"><input type="checkbox" data-change="canyoneering-check" data-index="${index}" ${done.includes(index) ? "checked" : ""} class="mt-0.5 h-4 w-4 shrink-0 rounded accent-brand-500" /><span class="text-xs font-medium text-ink-2">${H.esc(item)}</span></label>`).join("")}
        </div><p class="mt-4 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[11px] leading-relaxed text-warn"><strong>Safety check:</strong> Do not enter the river during dangerous weather or against local guide advice.</p></div>
      </div>
    </div>`;
  }

  function mount(host) { render(host); }

  Actions.onChange("canyoneering-check", (el) => {
    const values = new Set(checked());
    const index = Number(el.dataset.index);
    if (el.checked) values.add(index); else values.delete(index);
    save([...values].sort((a, b) => a - b));
    const progress = document.querySelector("[data-plan-progress]");
    if (progress) progress.textContent = `${values.size}/${essentials.length} packed`;
  });

  return { mount };
})();