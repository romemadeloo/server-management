const PhilippinesNews = (() => {
  const FEED = "https://news.google.com/rss/search?q=Philippines&hl=en-PH&gl=PH&ceid=PH:en";
  const PROXY = "https://api.rss2json.com/v1/api.json?rss_url=";
  const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=240&q=75";
  const fallback = [
    ["Open the latest Philippines headlines", "Google News", `https://news.google.com/search?q=Philippines&hl=en-PH&gl=PH&ceid=PH%3Aen`, "Latest", FALLBACK_IMAGE],
    ["Read Philippine news from major sources", "Inquirer.net", "https://newsinfo.inquirer.net/", "Latest", FALLBACK_IMAGE],
    ["Browse nationwide and local updates", "Philstar.com", "https://www.philstar.com/", "Latest", FALLBACK_IMAGE]
  ];
  let items = null;
  let loading = false;

  function timeText(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Latest";
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
  }

  function render(host) {
    if (!host) return;
    const rows = items || fallback;
    host.innerHTML = `<div class="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line">
      <div class="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div><p class="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-fg">Philippines</p><h2 class="mt-1 text-[17px] font-bold tracking-tight">Latest happenings</h2><p class="mt-1 text-xs text-faint">Fresh headlines from around the country.</p></div>
        <button type="button" data-action="refresh-philippines-news" title="Refresh news" class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint ring-1 ring-line-2 transition hover:bg-brand-soft hover:text-brand-fg">${H.icon("refresh", "h-3.5 w-3.5")}</button>
      </div>
      <div class="divide-y divide-line-soft px-5">${rows.map((item) => `<a href="${H.esc(item[2])}" target="_blank" rel="noopener noreferrer" class="flex gap-3 py-3 transition hover:bg-subtle"><img src="${H.esc(item[4] || FALLBACK_IMAGE)}" alt="" loading="lazy" class="h-14 w-20 shrink-0 rounded-lg object-cover ring-1 ring-line" /><span class="min-w-0"><p class="text-xs font-semibold leading-5 text-ink-2">${H.esc(item[0])}</p><p class="mt-1 text-[10px] text-faint">${H.esc(item[1])} · ${H.esc(item[3] || "Latest")}</p></span></a>`).join("")}</div>
      <p class="border-t border-line-soft px-5 py-3 text-[10px] text-faint">Headlines open in a new tab.</p>
    </div>`;
  }

  async function load(host) {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch(`${PROXY}${encodeURIComponent(FEED)}`);
      if (!response.ok) throw new Error("news request failed");
      const data = await response.json();
      if (!Array.isArray(data.items) || !data.items.length) throw new Error("no headlines");
      items = data.items.slice(0, 6).map((item) => [
        item.title,
        item.author || "Google News",
        item.link,
        timeText(item.pubDate),
        item.thumbnail || (item.enclosure && item.enclosure.link) || FALLBACK_IMAGE
      ]);
    } catch (err) {
      items = null;
    } finally {
      loading = false;
      render(host);
    }
  }

  function mount(host) {
    render(host);
    load(host);
  }

  Actions.on("refresh-philippines-news", () => load(document.querySelector("[data-philippines-news]")));
  return { mount };
})();