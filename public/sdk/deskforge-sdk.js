/*
 * DeskForge widget SDK v1. Classic script, no dependencies.
 * Talks to the host over a private MessageChannel; every call is permission-checked by the host.
 * See docs/WIDGETS.md.
 */
(function () {
  "use strict";

  var TIMEOUT_MS = 10000;
  var port = null;
  var nextId = 1;
  var pending = Object.create(null);
  var listeners = { theme: [], system: [] };
  var resolveReady;
  var ready = new Promise(function (resolve) { resolveReady = resolve; });
  var loadId = Math.random().toString(36).slice(2);

  function fail(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  function onPortMessage(ev) {
    var m = ev.data;
    if (!m || typeof m !== "object") return;
    if (m.kind === "res") {
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.result);
      else p.reject(fail((m.error && m.error.code) || "error", (m.error && m.error.message) || "Request failed."));
    } else if (m.kind === "event" && Object.prototype.hasOwnProperty.call(listeners, m.name)) {
      if (m.name === "theme") applyLayout(m.data && m.data.layout);
      listeners[m.name].slice().forEach(function (cb) {
        try { cb(m.data); } catch (e) { console.error(e); }
      });
    }
  }

  function request(method, params) {
    return ready.then(function () {
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        var timer = setTimeout(function () {
          delete pending[id];
          reject(fail("timeout", "The host didn’t answer in time."));
        }, TIMEOUT_MS);
        pending[id] = { resolve: resolve, reject: reject, timer: timer };
        port.postMessage({ kind: "req", id: id, method: method, params: params });
      });
    });
  }

  // Resolves with an unsubscribe function; the callback also receives the current value immediately.
  function subscribe(topic, cb) {
    if (typeof cb !== "function") return Promise.reject(fail("bad_request", "A callback is required."));
    listeners[topic].push(cb);
    return request(topic + ".subscribe").then(function (initial) {
      try { cb(initial); } catch (e) { console.error(e); }
      return function unsubscribe() {
        var i = listeners[topic].indexOf(cb);
        if (i >= 0) listeners[topic].splice(i, 1);
      };
    });
  }

  var VAR_NAME = /^--[a-z0-9-]+$/;
  var UNSAFE_VALUE = /[;{}]|url\(/i;
  function applyVars(vars) {
    if (!vars || typeof vars !== "object") return;
    Object.keys(vars).forEach(function (name) {
      var value = vars[name];
      if (VAR_NAME.test(name) && typeof value === "string" && !UNSAFE_VALUE.test(value)) {
        document.documentElement.style.setProperty(name, value);
      }
    });
  }

  function bounded(v, min, max, fallback) {
    return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  }

  function applyLayout(raw) {
    var config = raw && typeof raw === "object" ? raw : {};
    Array.prototype.forEach.call(document.querySelectorAll("[data-df-layout]"), function (el) {
      var id = el.getAttribute("data-df-layout");
      var item = id && config[id];
      if (!item || typeof item !== "object") {
        el.removeAttribute("data-df-layout-active");
        ["--df-layout-x", "--df-layout-y", "--df-layout-scale", "--df-layout-order", "--df-layout-opacity",
          "--df-layout-font-size", "--df-layout-color", "--df-layout-align"].forEach(function (name) {
          el.style.removeProperty(name);
        });
        ["font", "color", "align"].forEach(function (name) {
          el.removeAttribute("data-df-layout-" + name);
        });
        return;
      }
      el.setAttribute("data-df-layout-active", "true");
      el.style.setProperty("--df-layout-x", bounded(item.x, -100, 100, 0) + "vw");
      el.style.setProperty("--df-layout-y", bounded(item.y, -100, 100, 0) + "vh");
      el.style.setProperty("--df-layout-scale", String(bounded(item.scale, 0.25, 3, 1)));
      el.style.setProperty("--df-layout-order", String(bounded(item.order, 0, 100, 0)));
      el.style.setProperty("--df-layout-opacity", String(bounded(item.opacity, 0, 100, 100) / 100));
      if (typeof item.fontSize === "number" && Number.isFinite(item.fontSize)) {
        el.setAttribute("data-df-layout-font", "true");
        el.style.setProperty("--df-layout-font-size", bounded(item.fontSize, 8, 96, 16) + "px");
      } else {
        el.removeAttribute("data-df-layout-font");
        el.style.removeProperty("--df-layout-font-size");
      }
      if (typeof item.color === "string" && /^#[0-9a-f]{6}$/i.test(item.color)) {
        el.setAttribute("data-df-layout-color", "true");
        el.style.setProperty("--df-layout-color", item.color);
      } else {
        el.removeAttribute("data-df-layout-color");
        el.style.removeProperty("--df-layout-color");
      }
      if (item.align === "left" || item.align === "center" || item.align === "right") {
        el.setAttribute("data-df-layout-align", "true");
        el.style.setProperty("--df-layout-align", item.align);
      } else {
        el.removeAttribute("data-df-layout-align");
        el.style.removeProperty("--df-layout-align");
      }
    });
    requestAnimationFrame(reportLayoutElements);
  }

  function rgbHex(color) {
    var values = color.match(/\d+/g);
    if (!values || values.length < 3) return "#ffffff";
    return "#" + values.slice(0, 3).map(function (v) {
      return Math.max(0, Math.min(255, Number(v))).toString(16).padStart(2, "0");
    }).join("");
  }

  var lastLayoutReport = "";
  function reportLayoutElements() {
    var elements = [];
    Array.prototype.forEach.call(document.querySelectorAll("[data-df-layout]"), function (el) {
      var id = el.getAttribute("data-df-layout");
      if (!id || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(id)) return;
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return;
      var kind = el.getAttribute("data-df-layout-kind");
      if (kind !== "text" && kind !== "visual" && kind !== "interactive") kind = "visual";
      elements.push({
        id: id,
        label: (el.getAttribute("data-df-layout-label") || id).slice(0, 48),
        kind: kind,
        x: Math.round(rect.left * 10) / 10,
        y: Math.round(rect.top * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        fontSize: Math.round(parseFloat(style.fontSize) || 16),
        color: rgbHex(style.color),
        align: style.textAlign === "center" || style.textAlign === "right" ? style.textAlign : "left"
      });
    });
    var signature = JSON.stringify(elements);
    if (!port || signature === lastLayoutReport) return;
    lastLayoutReport = signature;
    port.postMessage({ kind: "notify", name: "layout-elements", elements: elements });
  }

  var layoutStyle = document.createElement("style");
  layoutStyle.textContent =
    '[data-df-layout-active="true"]{position:relative;translate:var(--df-layout-x,0vw) var(--df-layout-y,0vh);' +
    'scale:var(--df-layout-scale,1);z-index:var(--df-layout-order,auto);opacity:var(--df-layout-opacity,1)}' +
    '[data-df-layout-font="true"]{font-size:var(--df-layout-font-size)}' +
    '[data-df-layout-color="true"]{color:var(--df-layout-color)}' +
    '[data-df-layout-align="true"]{text-align:var(--df-layout-align)}';
  document.head.appendChild(layoutStyle);

  var layoutObserver = new MutationObserver(function () {
    requestAnimationFrame(reportLayoutElements);
  });
  layoutObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "class"]
  });
  window.addEventListener("resize", function () {
    requestAnimationFrame(reportLayoutElements);
  });

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.type !== "df-init" || !e.ports || !e.ports[0]) return;
    if (port) port.close();
    port = e.ports[0];
    port.onmessage = onPortMessage;
    resolveReady({ sdk: d.sdk, widgetId: d.widgetId });
  });

  // Announce ourselves; retry briefly in case the host listener attached a moment late.
  var tries = 0;
  function announce() {
    if (port || tries++ > 20) return;
    window.parent.postMessage({ type: "df-ready", loadId: loadId }, "*");
    setTimeout(announce, 250);
  }
  announce();

  // Hover reporting. The host can't see the pointer while it is over this iframe, so tell it. This is what
  // makes the move/resize controls appear. One-way notification: it carries no data and needs no permission.
  var over = false;
  function setOver(v) {
    if (v === over) return;
    over = v;
    if (port) port.postMessage({ kind: "notify", name: "hover", over: v });
  }
  var rootEl = document.documentElement;
  rootEl.addEventListener("pointerenter", function () { setOver(true); });
  rootEl.addEventListener("pointermove", function () { setOver(true); }, { passive: true });
  rootEl.addEventListener("pointerleave", function () { setOver(false); });
  document.addEventListener("mouseleave", function () { setOver(false); });

  window.deskforge = {
    version: 1,
    ready: function () { return ready; },
    theme: {
      get: function () { return request("theme.get"); },
      subscribe: function (cb) { return subscribe("theme", cb); },
      // Keep this widget's CSS variables in sync with the DeskForge theme.
      follow: function () {
        return subscribe("theme", function (payload) {
          applyVars(payload && payload.cssVars);
          applyLayout(payload && payload.layout);
        });
      },
    },
    system: {
      get: function () { return request("system.get"); },
      subscribe: function (cb) { return subscribe("system", cb); },
    },
    storage: {
      get: function (key) { return request("storage.get", { key: key }); },
      set: function (key, value) { return request("storage.set", { key: key, value: value }); },
      delete: function (key) { return request("storage.delete", { key: key }); },
    },
    launcher: {
      list: function () { return request("launcher.list"); },
      launch: function (id) { return request("launcher.launch", { id: id }); },
    },
    weather: {
      search: function (query) { return request("weather.search", { query: query }); },
      get: function (lat, lon, units) { return request("weather.get", { lat: lat, lon: lon, units: units }); },
    },
  };
})();
