(function () {
  "use strict";
  var cpuEl = document.getElementById("cpu");
  var memEl = document.getElementById("mem");
  var line = document.getElementById("line");
  var history = [];

  function gb(n) { return (n / 1073741824).toFixed(1) + " GB"; }

  function onSnapshot(s) {
    history.push(s.cpuPercent);
    if (history.length > 60) history.shift();
    var step = 100 / 59;
    line.setAttribute("points", history.map(function (v, i) {
      return ((i + 60 - history.length) * step).toFixed(1) + "," + (27 - (Math.min(100, v) / 100) * 26).toFixed(1);
    }).join(" "));
    cpuEl.textContent = Math.round(s.cpuPercent) + "%";
    memEl.textContent = gb(s.memUsed) + " of " + gb(s.memTotal);
  }

  deskforge.theme.follow().catch(function () {});
  deskforge.system.subscribe(onSnapshot).catch(function (e) { cpuEl.textContent = e.message; });
})();
