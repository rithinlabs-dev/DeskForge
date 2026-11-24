(function () {
  "use strict";
  var timeEl = document.getElementById("time");
  var dateEl = document.getElementById("date");

  function tick() {
    var now = new Date();
    timeEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    dateEl.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }
  tick();
  setInterval(tick, 15000);

  deskforge.theme.follow().catch(function () {});
})();
