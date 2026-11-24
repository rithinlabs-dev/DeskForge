import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Theme } from "./api";
import AppearancePage from "./pages/AppearancePage";
import OverviewPage from "./pages/OverviewPage";
import { EffectsPage, ImagesPage, IslandPage, WallpaperPage, WidgetsPage } from "./pages/SimplePages";
import SystemPage from "./pages/SystemPage";
import Shell from "./shell/Shell";
import { Icon } from "./shell/icons";
import { DEFAULT_SECTION, hashFor, isSectionId, parseHash, sectionForShortcut, type SectionId } from "./shell/nav";
import { createPackage, packageFileName, parsePackage, serializePackage } from "./shared/themePackage";
import { useSystem } from "./system";
import { DEFAULT_TOKENS, applyTokens, sanitizeTokens, type Tokens } from "./tokens";
import { useTokenHistory } from "./useTokenHistory";

export default function App() {
  const h = useTokenHistory(DEFAULT_TOKENS);
  const sys = useSystem();
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeName, setThemeName] = useState("");

  // Which page is showing. The address (#/widgets) wins; otherwise the page you were last on.
  const [section, setSection] = useState<SectionId>(() => parseHash(window.location.hash) ?? DEFAULT_SECTION);
  const hadAddress = useRef(parseHash(window.location.hash) !== null);
  useEffect(() => {
    if (hadAddress.current) return;
    api.settings
      .get<string>("ui:section")
      .then((v) => {
        if (isSectionId(v)) {
          setSection(v);
          history.replaceState(null, "", hashFor(v));
        }
      })
      .catch(() => {});
  }, []);
  const navigate = useCallback((id: SectionId) => {
    setSection(id);
    if (window.location.hash !== hashFor(id)) history.replaceState(null, "", hashFor(id));
    api.settings.set("ui:section", id).catch(() => {});
  }, []);
  useEffect(() => {
    const onHash = () => {
      const id = parseHash(window.location.hash);
      if (id) setSection(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Sidebar: full or icons only (remembered). Ctrl+B toggles it.
  const [sidebar, setSidebar] = useState(true);
  const [uiLoaded, setUiLoaded] = useState(false);
  useEffect(() => {
    api.settings
      .get<boolean>("ui:sidebar")
      .then((v) => typeof v === "boolean" && setSidebar(v))
      .catch(() => {})
      .finally(() => setUiLoaded(true));
  }, []);
  useEffect(() => {
    if (uiLoaded) api.settings.set("ui:sidebar", sidebar).catch(() => {});
  }, [sidebar, uiLoaded]);

  // Keyboard: Ctrl+B sidebar, Ctrl+1..8 sections, Ctrl+Z / Ctrl+Y undo and redo your look (only on Appearance, so it
  // never fights another page's own undo, like the image composer's).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      const typing = (el instanceof HTMLInputElement && el.type === "text") || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        setSidebar((s) => !s);
        return;
      }
      const jump = sectionForShortcut(k);
      if (jump && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        navigate(jump);
        return;
      }
      if (typing || section !== "appearance") return;
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        h.undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        h.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section, navigate, h.undo, h.redo]);

  // Apply tokens to the whole window as CSS variables.
  useEffect(() => applyTokens(h.tokens), [h.tokens]);

  // Load saved working tokens + theme list once.
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const raw = await api.settings.get("tokens");
        if (!off && raw) h.load(sanitizeTokens(raw));
        if (!off) setThemes(await api.themes.list());
      } catch (e) {
        setNotice(`Storage unavailable: ${String(e)}`);
      } finally {
        if (!off) setReady(true);
      }
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced autosave.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      api.settings.set("tokens", h.tokens).catch((e) => setNotice(`Couldn’t save: ${String(e)}`));
    }, 400);
    return () => clearTimeout(t);
  }, [ready, h.tokens]);

  // The desktop menu can change the theme too: adopt it here as an undoable step.
  const tokensRef = useRef(h.tokens);
  tokensRef.current = h.tokens;
  useEffect(() => {
    let dead = false;
    let un: (() => void) | undefined;
    api.settings
      .onChanged(async (key) => {
        if (key !== "tokens") return;
        const next = sanitizeTokens(await api.settings.get("tokens"));
        const cur = tokensRef.current;
        if ((Object.keys(next) as (keyof Tokens)[]).some((k) => next[k] !== cur[k])) h.edit(next, "external");
      })
      .then((f) => (dead ? f() : (un = f)))
      .catch(() => {});
    return () => {
      dead = true;
      un?.();
    };
  }, [h.edit]);

  const set = (patch: Partial<Tokens>, key: string) => h.edit(patch, key);

  const saveTheme = async () => {
    const name = themeName.trim();
    if (!name) return;
    try {
      const t = await api.themes.save(name, { ...h.tokens });
      setThemes(await api.themes.list());
      setThemeName("");
      setNotice(`Saved “${t.name}”`);
    } catch (e) {
      setNotice(`Couldn’t save theme: ${String(e)}`);
    }
  };

  const deleteTheme = async (t: Theme) => {
    try {
      await api.themes.delete(t.id);
      setThemes(await api.themes.list());
      setNotice(`Deleted “${t.name}”`);
    } catch (e) {
      setNotice(`Couldn’t delete theme: ${String(e)}`);
    }
  };

  const exportTokens = async (name: string, tokens: Tokens) => {
    try {
      const json = serializePackage(createPackage(name, tokens));
      const saved = await api.themes.exportFile(packageFileName(name), json);
      if (saved) setNotice(`Exported “${name}”`);
    } catch (e) {
      setNotice(`Couldn’t export: ${String(e)}`);
    }
  };

  const importTheme = async () => {
    try {
      const text = await api.themes.importFile();
      if (text === null) return;
      const res = parsePackage(text);
      if (!res.ok) {
        setNotice(res.error);
        return;
      }
      h.edit(res.pkg.tokens, "import"); // undoable
      setThemeName(res.pkg.meta.name);
      const by = res.pkg.meta.author ? ` by ${res.pkg.meta.author}` : "";
      setNotice([`Imported “${res.pkg.meta.name}”${by}. Save it to keep it in your list.`, ...res.warnings].join(" "));
    } catch (e) {
      setNotice(`Couldn’t import: ${String(e)}`);
    }
  };

  const actions =
    section === "appearance" ? (
      <>
        <button className="btn" onClick={h.undo} disabled={!h.canUndo} title="Ctrl+Z"><Icon name="undo" size={16} /> Undo</button>
        <button className="btn" onClick={h.redo} disabled={!h.canRedo} title="Ctrl+Y"><Icon name="redo" size={16} /> Redo</button>
      </>
    ) : undefined;

  return (
    <Shell
      section={section}
      onNavigate={navigate}
      sidebarOpen={sidebar}
      onToggleSidebar={() => setSidebar((s) => !s)}
      onMenuMode={() => api.menu.open().catch(() => {})}
      actions={actions}
    >
      {section === "overview" && <OverviewPage sys={sys} tokens={h.tokens} onNavigate={navigate} />}
      {section === "appearance" && (
        <AppearancePage
          tokens={h.tokens}
          set={set}
          themes={themes}
          themeName={themeName}
          onThemeName={setThemeName}
          onSave={saveTheme}
          onDelete={deleteTheme}
          onImport={importTheme}
          onExport={exportTokens}
          notice={notice}
          snap={sys.snap}
        />
      )}
      {section === "widgets" && <WidgetsPage tokens={h.tokens} snapshot={sys.snap} />}
      {section === "wallpaper" && <WallpaperPage />}
      {section === "images" && <ImagesPage />}
      {section === "effects" && <EffectsPage />}
      {section === "island" && <IslandPage />}
      {section === "system" && <SystemPage sys={sys} />}
    </Shell>
  );
}
