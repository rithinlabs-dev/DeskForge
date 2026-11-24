// Renders a user-made HUD: the parts come from the widget's stored config, the look from the uploaded CSS.
(function () {
  "use strict";
  var hud = document.getElementById("hud");
  var root = document.documentElement;
  var els = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function markLayout(elm, id, label, kind) {
    elm.setAttribute("data-df-layout", id);
    elm.setAttribute("data-df-layout-label", label);
    elm.setAttribute("data-df-layout-kind", kind);
  }
  function simple(type, text, id, kind) {
    var p = el("div", "part " + type);
    markLayout(p, id, text || type, kind || "text");
    var v = el("span", "value", text || "");
    p.appendChild(v);
    hud.appendChild(p);
    return v;
  }
  function meter(type, label, id) {
    var p = el("div", "part " + type);
    markLayout(p, id, label, "visual");
    var v = el("span", "value", "–");
    var bar = el("div", "bar");
    bar.appendChild(el("i"));
    p.appendChild(el("span", "label", label));
    p.appendChild(v);
    p.appendChild(bar);
    hud.appendChild(p);
    return { value: v, bar: bar };
  }
  function build(parts) {
    var counts = Object.create(null);
    parts.forEach(function (p) {
      var index = counts[p.type] || 0;
      counts[p.type] = index + 1;
      var id = p.type + "-" + index;
      if (p.type === "clock") els.clock = simple("clock", "", id);
      else if (p.type === "date") els.date = simple("date", "", id);
      else if (p.type === "text") simple("text", p.text, id);
      else if (p.type === "cpu") els.cpu = meter("cpu", "cpu", id);
      else if (p.type === "memory") els.memory = meter("memory", "mem", id);
      else if (p.type === "net") {
        var n = el("div", "part net");
        markLayout(n, id, "Network", "visual");
        els.net = el("span", "value", "–");
        n.appendChild(el("span", "label", "net"));
        n.appendChild(els.net);
        hud.appendChild(n);
      }
    });
  }

  function applyCss(css) {
    if (typeof css !== "string" || !css) return;
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [sheet]; // after the base styles, so the user's CSS wins
    } catch (e) {
      var s = document.createElement("style");
      s.textContent = css;
      document.head.appendChild(s);
    }
  }

  function tick() {
    var now = new Date();
    if (els.clock) els.clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (els.date) els.date.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }

  function rate(n) {
    if (n < 1024) return Math.round(n) + " B/s";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB/s";
    return (n / 1048576).toFixed(1) + " MB/s";
  }

  var prevTs = null;
  function onSnapshot(s) {
    var cpu = Math.round(s.cpuPercent);
    var mem = s.memTotal ? Math.round((s.memUsed / s.memTotal) * 100) : 0;
    root.style.setProperty("--cpu", cpu);
    root.style.setProperty("--mem", mem);
    if (els.cpu) { els.cpu.value.textContent = cpu + "%"; els.cpu.bar.style.setProperty("--pct", cpu); }
    if (els.memory) { els.memory.value.textContent = mem + "%"; els.memory.bar.style.setProperty("--pct", mem); }
    if (els.net && prevTs !== null) {
      var dt = (s.timestampMs - prevTs) / 1000;
      if (dt > 0) els.net.textContent = "↓ " + rate(s.netRxBytes / dt) + "  ↑ " + rate(s.netTxBytes / dt);
    }
    prevTs = s.timestampMs;
  }

  deskforge.theme.follow().catch(function () {});
  Promise.all([deskforge.storage.get("config"), deskforge.storage.get("css")])
    .then(function (r) {
      applyCss(r[1]);
      build(r[0] && Array.isArray(r[0].parts) ? r[0].parts : []);
      tick();
      setInterval(tick, 15000);
      if (els.cpu || els.memory || els.net) return deskforge.system.subscribe(onSnapshot);
    })
    .catch(function (e) { hud.textContent = "Couldn’t load this HUD: " + e.message; });
})();
