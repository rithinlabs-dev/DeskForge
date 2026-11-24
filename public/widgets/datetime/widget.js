// Date, time and weather. Settings live in this widget's own storage; weather comes through the host bridge
// (the widget itself has no network access).
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var HEX = /^#[0-9a-f]{6}$/i;
  var FONTS = {
    theme: "var(--font)",
    mono: '"Cascadia Mono", Consolas, monospace',
    serif: 'Georgia, "Times New Roman", serif',
    sans: '"Segoe UI", system-ui, sans-serif',
  };
  var CODES = [
    [[0], "Clear"], [[1, 2, 3], "Partly cloudy"], [[45, 48], "Fog"], [[51, 53, 55, 56, 57], "Drizzle"],
    [[61, 63, 65, 66, 67], "Rain"], [[71, 73, 75, 77], "Snow"], [[80, 81, 82], "Showers"],
    [[85, 86], "Snow showers"], [[95, 96, 99], "Thunderstorm"],
  ];

  var cfg = sanitize(null);
  var wx = null;
  var tickTimer = null;
  var wxTimer = null;

  function sanitize(raw) {
    var r = raw && typeof raw === "object" ? raw : {};
    var p = r.place;
    var place = p && typeof p.name === "string" && typeof p.lat === "number" && typeof p.lon === "number" &&
      Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 ? { name: p.name.slice(0, 60), lat: p.lat, lon: p.lon } : null;
    return {
      showTime: r.showTime !== false,
      showDate: r.showDate !== false,
      showWeather: r.showWeather !== false,
      hour12: r.hour12 === true,
      seconds: r.seconds === true,
      layout: r.layout === "row" ? "row" : "stack",
      style: ["clean", "bold", "digital"].indexOf(r.style) >= 0 ? r.style : "clean",
      font: ["theme", "mono", "serif", "sans"].indexOf(r.font) >= 0 ? r.font : "theme",
      color: typeof r.color === "string" && HEX.test(r.color) ? r.color : "",
      units: r.units === "f" ? "f" : "c",
      place: place,
    };
  }

  function msg(text) { $("msg").textContent = text || ""; }
  function save() {
    deskforge.storage.set("config", cfg).catch(function (e) { msg("Couldn’t save: " + e.message); });
  }

  function describe(code) {
    for (var i = 0; i < CODES.length; i++) if (CODES[i][0].indexOf(code) >= 0) return CODES[i][1];
    return "Weather";
  }

  function render() {
    var root = $("dt");
    root.className = "dt layout-" + cfg.layout + " style-" + cfg.style;
    root.style.fontFamily = FONTS[cfg.font];
    root.style.color = cfg.color || "";

    var now = new Date();
    var timeEl = $("time"), dateEl = $("date"), wxEl = $("wx");
    timeEl.hidden = !cfg.showTime;
    dateEl.hidden = !cfg.showDate;
    wxEl.hidden = !cfg.showWeather;
    $("hint").hidden = cfg.showTime || cfg.showDate || cfg.showWeather;

    if (cfg.showTime) {
      timeEl.textContent = now.toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit", second: cfg.seconds ? "2-digit" : undefined,
        hourCycle: cfg.hour12 ? "h12" : "h23",
      });
    }
    if (cfg.showDate) dateEl.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    if (cfg.showWeather) {
      if (!cfg.place) wxEl.textContent = "Set a city in settings (gear).";
      else if (!wx) wxEl.textContent = cfg.place.name + " · loading…";
      else wxEl.textContent = describe(wx.weatherCode) + " · " + wx.temperature + "°" + (wx.units === "f" ? "F" : "C") + " · " + cfg.place.name;
    }
  }

  function schedule() {
    clearInterval(tickTimer);
    tickTimer = setInterval(render, cfg.seconds ? 1000 : 15000);
  }

  function refreshWeather() {
    clearTimeout(wxTimer);
    if (!cfg.showWeather || !cfg.place) { wx = null; render(); return; }
    deskforge.weather.get(cfg.place.lat, cfg.place.lon, cfg.units)
      .then(function (w) { wx = w; msg(""); render(); })
      .catch(function (e) { msg("Weather: " + e.message); });
    wxTimer = setTimeout(refreshWeather, 10 * 60 * 1000);
  }

  function syncForm() {
    $("s-time").checked = cfg.showTime;
    $("s-date").checked = cfg.showDate;
    $("s-weather").checked = cfg.showWeather;
    $("s-hour").value = cfg.hour12 ? "12" : "24";
    $("s-seconds").checked = cfg.seconds;
    $("s-layout").value = cfg.layout;
    $("s-style").value = cfg.style;
    $("s-font").value = cfg.font;
    $("s-usecolor").checked = cfg.color !== "";
    if (cfg.color) $("s-color").value = cfg.color;
    $("s-units").value = cfg.units;
    $("s-place").value = cfg.place ? cfg.place.name : "";
  }

  function changed(refetch) {
    render();
    schedule();
    save();
    if (refetch) refreshWeather();
  }

  $("gear").addEventListener("click", function () { $("cfg").hidden = !$("cfg").hidden; });
  $("s-done").addEventListener("click", function () { $("cfg").hidden = true; });
  $("s-time").addEventListener("change", function (e) { cfg.showTime = e.target.checked; changed(false); });
  $("s-date").addEventListener("change", function (e) { cfg.showDate = e.target.checked; changed(false); });
  $("s-weather").addEventListener("change", function (e) { cfg.showWeather = e.target.checked; changed(true); });
  $("s-hour").addEventListener("change", function (e) { cfg.hour12 = e.target.value === "12"; changed(false); });
  $("s-seconds").addEventListener("change", function (e) { cfg.seconds = e.target.checked; changed(false); });
  $("s-layout").addEventListener("change", function (e) { cfg.layout = e.target.value; changed(false); });
  $("s-style").addEventListener("change", function (e) { cfg.style = e.target.value; changed(false); });
  $("s-font").addEventListener("change", function (e) { cfg.font = e.target.value; changed(false); });
  $("s-units").addEventListener("change", function (e) { cfg.units = e.target.value; changed(true); });
  function colour() { cfg.color = $("s-usecolor").checked ? $("s-color").value : ""; changed(false); }
  $("s-usecolor").addEventListener("change", colour);
  $("s-color").addEventListener("input", function () { $("s-usecolor").checked = true; colour(); });

  $("s-search").addEventListener("click", function () {
    var q = $("s-place").value.trim();
    var list = $("s-results");
    list.textContent = "";
    if (q.length < 2) { msg("Type at least 2 letters."); return; }
    msg("Searching…");
    deskforge.weather.search(q).then(function (places) {
      msg(places.length ? "" : "No places found.");
      places.forEach(function (p) {
        var li = document.createElement("li");
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = [p.name, p.region, p.country].filter(Boolean).join(", ");
        b.addEventListener("click", function () {
          cfg.place = { name: p.name, lat: p.lat, lon: p.lon };
          cfg.showWeather = true;
          list.textContent = "";
          syncForm();
          changed(true);
        });
        li.appendChild(b);
        list.appendChild(li);
      });
    }).catch(function (e) { msg("Search failed: " + e.message); });
  });

  deskforge.theme.follow().catch(function () {});
  deskforge.storage.get("config")
    .then(function (saved) { cfg = sanitize(saved); })
    .catch(function () {})
    .then(function () { syncForm(); render(); schedule(); refreshWeather(); });
})();
