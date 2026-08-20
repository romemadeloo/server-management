const WeatherReport = (() => {
  const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
  const CACHE_KEY = "serverManager.weather";
  const CACHE_TTL = 15 * 60 * 1000;
  const DEFAULT_LOCATION = {
    label: "Cebu",
    coords: { latitude: 10.3157, longitude: 123.8854 }
  };
  const conditions = {
    0: ["Clear sky", "sun"],
    1: ["Mainly clear", "sun"], 2: ["Partly cloudy", "cloud"], 3: ["Overcast", "cloud"],
    45: ["Foggy", "cloud"], 48: ["Rime fog", "cloud"],
    51: ["Light drizzle", "cloud-rain"], 53: ["Drizzle", "cloud-rain"], 55: ["Heavy drizzle", "cloud-rain"],
    61: ["Light rain", "cloud-rain"], 63: ["Rain", "cloud-rain"], 65: ["Heavy rain", "cloud-rain"],
    71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"],
    80: ["Rain showers", "cloud-rain"], 81: ["Rain showers", "cloud-rain"], 82: ["Heavy showers", "cloud-rain"],
    95: ["Thunderstorm", "cloud-lightning"], 96: ["Storm with hail", "cloud-lightning"], 99: ["Storm with hail", "cloud-lightning"]
  };
  let report = readCache();
  let loading = false;

  function readCache() {
    try {
      const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      return saved && Date.now() - saved.savedAt < CACHE_TTL ? saved.data : null;
    } catch (err) { return null; }
  }

  function save(data) {
    report = data;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data })); } catch (err) { /* cache is optional */ }
  }

  function icon(name) {
    const paths = {
      sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M4.7 4.7l1.4 1.4M17.9 17.9l1.4 1.4M2.5 12h2M19.5 12h2M4.7 19.3l1.4-1.4M17.9 6.1l1.4-1.4"/>',
      cloud: '<path d="M6.5 18.5h10a4 4 0 000-8 5.5 5.5 0 00-10.2-1.8A4.5 4.5 0 006.5 18.5z"/>',
      "cloud-rain": '<path d="M6.5 15.5h10a4 4 0 000-8 5.5 5.5 0 00-10.2-1.8A4.5 4.5 0 006.5 15.5zM8 18l-1 2M13 18l-1 2M18 18l-1 2"/>',
      snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M8 5.3l4 2.3 4-2.3M8 18.7l4-2.3 4 2.3"/>',
      "cloud-lightning": '<path d="M6.5 14.5h10a4 4 0 000-8 5.5 5.5 0 00-10.2-1.8A4.5 4.5 0 006.5 14.5zM13 14l-3 5h3l-1 3 4-6h-3z"/>'
    };
    return `<svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cloud}</svg>`;
  }

  function tone(iconName) {
    return iconName === "sun" ? "bg-warn-soft text-warn"
      : iconName === "cloud-rain" ? "bg-brand-soft text-brand-fg"
      : iconName === "snow" ? "bg-info-soft text-info"
      : iconName === "cloud-lightning" ? "bg-bad-soft text-bad"
      : "bg-subtle-2 text-muted";
  }

  function dayName(date, index) {
    if (index === 0) return "Today";
    return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
  }

  function view(message) {
    return `<div class="flex min-h-24 items-center justify-between gap-4 rounded-2xl bg-surface px-5 py-4 shadow-sm ring-1 ring-line">
      <div class="flex items-center gap-3.5"><span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-fg">${icon("cloud")}</span>
        <div><p class="text-sm font-bold">Weather report</p><p class="mt-0.5 text-xs text-faint">${H.esc(message)}</p></div></div>
      <button type="button" data-action="weather-locate" class="shrink-0 rounded-full px-3 py-2 text-xs font-semibold text-brand-fg ring-1 ring-brand-soft transition hover:bg-brand-soft">${report ? "Refresh" : "Use my location"}</button>
    </div>`;
  }

  function render(host) {
    if (!host) return;
    if (!report || !report.forecast) { host.innerHTML = view("Local conditions at a glance"); return; }
    const [label, iconName] = conditions[report.code] || ["Current conditions", "cloud"];
    const weatherTone = tone(iconName);
    const forecast = report.forecast.map((day, index) => {
      const [dayLabel, dayIcon] = conditions[day.code] || ["Conditions", "cloud"];
      return `<div class="min-w-24 flex-1 rounded-xl bg-panel px-3 py-3 text-center">
        <p class="text-[11px] font-bold text-ink-2">${H.esc(dayName(day.date, index))}</p>
        <span class="mx-auto my-2 grid h-9 w-9 place-items-center rounded-lg ${tone(dayIcon)}">${icon(dayIcon)}</span>
        <p class="truncate text-[10px] text-faint" title="${H.esc(dayLabel)}">${H.esc(dayLabel)}</p>
        <p class="mt-1 text-xs font-bold"><span>${Math.round(day.high)}°</span><span class="ml-1 font-medium text-faint">${Math.round(day.low)}°</span></p>
      </div>`;
    }).join("");
    host.innerHTML = `<div class="overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line">
      <div class="flex flex-wrap items-center justify-between gap-4 px-5 py-4 ${weatherTone}">
      <div class="flex items-center gap-3.5"><span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl ${weatherTone}">${icon(iconName)}</span><div><p class="text-sm font-bold">Weather report</p><p class="mt-0.5 text-xs text-faint">${H.esc(report.location)} · ${H.esc(label)}</p></div></div>
      <div class="flex items-baseline gap-3"><strong class="text-2xl font-bold tracking-tight">${Math.round(report.temperature)}°</strong><span class="text-xs text-faint">High ${Math.round(report.high)}° · Low ${Math.round(report.low)}°</span><button type="button" data-action="weather-locate" title="Refresh weather" class="ml-2 grid h-8 w-8 place-items-center rounded-full text-faint ring-1 ring-line-2 transition hover:bg-brand-soft hover:text-brand-fg">${H.icon("refresh", "h-3.5 w-3.5")}</button></div>
      </div>
      <div class="grid grid-cols-2 gap-2 border-t border-line-soft p-3 sm:grid-cols-5">${forecast}</div>
    </div>`;
  }

  async function load(host, position) {
    if (loading || !host) return;
    loading = true;
    host.innerHTML = view("Loading local conditions…");
    try {
      const { latitude, longitude } = position.coords;
      const params = new URLSearchParams({ latitude, longitude, current: "temperature_2m,weather_code", daily: "weather_code,temperature_2m_max,temperature_2m_min", timezone: "auto", forecast_days: "5" });
      const response = await fetch(`${WEATHER_URL}?${params}`);
      if (!response.ok) throw new Error("weather request failed");
      const data = await response.json();
      save({
        location: position.label || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
        temperature: data.current.temperature_2m,
        code: data.current.weather_code,
        high: data.daily.temperature_2m_max[0],
        low: data.daily.temperature_2m_min[0],
        forecast: data.daily.time.map((date, index) => ({
          date, code: data.daily.weather_code[index],
          high: data.daily.temperature_2m_max[index], low: data.daily.temperature_2m_min[index]
        }))
      });
      render(host);
    } catch (err) {
      host.innerHTML = view("Weather is unavailable right now");
    } finally { loading = false; }
  }

  function locate(host) {
    if (!host) return;
    if (!navigator.geolocation) { load(host, DEFAULT_LOCATION); return; }
    navigator.geolocation.getCurrentPosition((position) => load(host, position), () => {
      load(host, DEFAULT_LOCATION);
    }, { maximumAge: CACHE_TTL, timeout: 8000 });
  }

  function mount(host) {
    render(host);
    if (!report || !report.forecast) load(host, DEFAULT_LOCATION);
  }

  Actions.on("weather-locate", () => locate(document.querySelector("[data-weather-report]")));
  return { mount };
})();