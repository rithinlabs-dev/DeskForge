(function () {
  "use strict";
  var box = document.getElementById("note");
  var status = document.getElementById("status");
  var timer = null;
  var loaded = false;

  function save() {
    deskforge.storage.set("text", box.value)
      .then(function () { status.textContent = "Saved"; })
      .catch(function (e) { status.textContent = "Couldn’t save: " + e.message; });
  }

  deskforge.theme.follow().catch(function () {});

  deskforge.storage.get("text")
    .then(function (text) {
      if (typeof text === "string") box.value = text;
      loaded = true;
      box.disabled = false;
    })
    .catch(function (e) { status.textContent = "Couldn’t load notes: " + e.message; });

  box.addEventListener("input", function () {
    if (!loaded) return;
    status.textContent = "Saving…";
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  });
})();
