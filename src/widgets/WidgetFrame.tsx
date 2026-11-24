import { useEffect, useRef } from "react";
import { api, type SystemSnapshot } from "../api";
import { themeCssVars, type Tokens } from "../shared/tokens";
import { DEFAULT_APPEARANCE, appearanceVars, type Appearance, type SystemTheme } from "./appearance";
import { createBridge, type Bridge, type HostServices } from "./bridge";
import type { Permission, WidgetManifest } from "./manifest";
import { widgetUrl } from "./registry";
import { currentWeather, searchPlaces } from "./weather";
import { sanitizeWidgetElements, type WidgetElementInfo, type WidgetLayout } from "./layout";

interface Props {
  manifest: WidgetManifest;
  granted: Permission[];
  tokens: Tokens;
  snapshot: SystemSnapshot | null;
  /** Per-widget appearance: native blur is applied by the desktop window. */
  appearance?: Appearance;
  layout?: WidgetLayout;
  systemTheme: SystemTheme;
  /** Fill the parent's height instead of using the manifest height (desktop windows). */
  fill?: boolean;
  /** Pointer entered/left the widget (reported by the SDK from inside the sandbox). */
  onHover?: (over: boolean) => void;
  onLayoutElements?: (elements: WidgetElementInfo[]) => void;
}

const cssVarsFor = (t: Tokens, a: Appearance, systemTheme: SystemTheme) => ({
  ...Object.fromEntries(Object.entries(themeCssVars(t)).filter(([k]) => !k.startsWith("--bg-art"))),
  ...appearanceVars(a, systemTheme),
});

/**
 * Runs one widget in a sandboxed iframe (allow-scripts only: opaque origin, no access to
 * the app's DOM, storage, or Tauri IPC). All communication goes over a private MessageChannel
 * into the permission-checked bridge.
 */
export default function WidgetFrame({ manifest, granted, tokens, snapshot, appearance = DEFAULT_APPEARANCE, layout = {}, systemTheme, fill = false, onHover, onLayoutElements }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<Bridge | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  const tokensRef = useRef(tokens);
  const snapRef = useRef(snapshot);
  const lookRef = useRef(appearance);
  const systemThemeRef = useRef(systemTheme);
  const layoutRef = useRef(layout);
  tokensRef.current = tokens;
  snapRef.current = snapshot;
  lookRef.current = appearance;
  systemThemeRef.current = systemTheme;
  layoutRef.current = layout;
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const layoutElementsRef = useRef(onLayoutElements);
  layoutElementsRef.current = onLayoutElements;
  const grantKey = granted.join(",");

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const services: HostServices = {
      theme: () => ({
        tokens: tokensRef.current,
        cssVars: cssVarsFor(tokensRef.current, lookRef.current, systemThemeRef.current),
        layout: layoutRef.current,
      }),
      system: async () => snapRef.current ?? api.system.snapshot(),
      loadStore: (id) => api.widgetStore.load(id),
      saveStore: (id, data) => api.widgetStore.save(id, data),
      launcherList: async () => (await api.launcher.list()).map(({ id, name }) => ({ id, name })),
      launcherLaunch: (id) => api.launcher.launch(id),
      weatherSearch: (q) => searchPlaces(q),
      weatherGet: (lat, lon, units) => currentWeather(lat, lon, units),
    };
    const bridge = createBridge({ manifest, granted: new Set(granted), services });
    bridgeRef.current = bridge;
    let lastLoad = "";

    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return; // only OUR iframe
      const d = e.data as { type?: unknown; loadId?: unknown } | null;
      if (!d || d.type !== "df-ready") return;
      const loadId = typeof d.loadId === "string" ? d.loadId : "";
      if (loadId && loadId === lastLoad) return; // SDK retry of a handshake we already answered
      lastLoad = loadId;

      portRef.current?.close();
      const channel = new MessageChannel();
      portRef.current = channel.port1;
      channel.port1.onmessage = async (ev) => {
        const m = ev.data as { kind?: unknown; name?: unknown; over?: unknown; elements?: unknown } | null;
        if (m && m.kind === "notify") {
          if (m.name === "hover") hoverRef.current?.(m.over === true); // one-way, never reaches the bridge
          if (m.name === "layout-elements") layoutElementsRef.current?.(sanitizeWidgetElements(m.elements));
          return;
        }
        channel.port1.postMessage(await bridge.handle(ev.data));
      };
      iframe.contentWindow?.postMessage({ type: "df-init", sdk: 1, widgetId: manifest.id }, "*", [channel.port2]);
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      portRef.current?.close();
      portRef.current = null;
      bridgeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, grantKey]);

  // Push updates only to widgets that subscribed (which required the permission).
  useEffect(() => {
    if (bridgeRef.current?.subscribed("theme")) {
      portRef.current?.postMessage({
        kind: "event",
        name: "theme",
        data: { tokens, cssVars: cssVarsFor(tokens, appearance, systemTheme), layout },
      });
    }
  }, [tokens, appearance, systemTheme, layout]);

  useEffect(() => {
    if (snapshot && bridgeRef.current?.subscribed("system")) {
      portRef.current?.postMessage({ kind: "event", name: "system", data: snapshot });
    }
  }, [snapshot]);

  return (
    <iframe
      ref={iframeRef}
      className="widget-frame"
      title={manifest.name}
      src={widgetUrl(manifest)}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={{
        display: "block",
        width: "100%",
        height: fill ? "100%" : manifest.height,
        border: 0, // the browser default is a 2px inset border in the text colour: that was the white line
        padding: 0,
        margin: 0,
        background: "transparent",
      }}
    />
  );
}
