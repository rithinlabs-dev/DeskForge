import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { groupedSections, hashFor, sectionById, shortcutFor, type SectionId } from "./nav";

export interface ShellProps {
  section: SectionId;
  onNavigate: (id: SectionId) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onMenuMode: () => void;
  /** Buttons for the top-right of the page (for example Undo and Redo). */
  actions?: ReactNode;
  children: ReactNode;
}

/** The frame of the app: a sidebar with the sections, and a scrolling stage with a large page title. */
export default function Shell({ section, onNavigate, sidebarOpen, onToggleSidebar, onMenuMode, actions, children }: ShellProps) {
  const current = sectionById(section);
  const stage = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const [scrolled, setScrolled] = useState(false);

  // This window gets the app styling (the desktop menu window shares the stylesheet but not this look).
  useEffect(() => {
    document.body.classList.add("shell-mode");
    return () => document.body.classList.remove("shell-mode");
  }, []);

  // A new page starts at the top, the window title says where you are, and the heading takes keyboard focus.
  useEffect(() => {
    document.title = section === "overview" ? "DeskForge" : `DeskForge · ${current.label}`;
    stage.current?.scrollTo({ top: 0 });
    setScrolled(false);
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus({ preventScroll: true });
  }, [section, current.label]);

  // The compact title in the top bar appears once the large one has scrolled away.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrolled(el.scrollTop > 72));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className={`shell${sidebarOpen ? "" : " rail"}`}>
      <nav className="side" aria-label="Sections" id="sidebar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <span className="brand-name">DeskForge</span>
        </div>

        <div className="side-scroll">
          {groupedSections().map(({ group, items }) => (
            <div className="side-group" key={group}>
              <p className="side-label">{group}</p>
              <ul>
                {items.map((s) => (
                  <li key={s.id}>
                    <a
                      href={hashFor(s.id)}
                      className={`side-link${s.id === section ? " on" : ""}`}
                      aria-current={s.id === section ? "page" : undefined}
                      title={`${s.label} (Ctrl+${shortcutFor(s.id)})`}
                      onClick={(e) => {
                        e.preventDefault();
                        onNavigate(s.id);
                      }}
                    >
                      <Icon name={s.icon} />
                      <span className="side-text">{s.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="side-foot">
          <button className="side-link" onClick={onMenuMode} title="Collapse into a small desktop menu">
            <Icon name="menu" />
            <span className="side-text">Menu mode</span>
          </button>
          <button className="side-link" onClick={onToggleSidebar} aria-expanded={sidebarOpen} aria-controls="sidebar" title="Ctrl+B">
            <Icon name={sidebarOpen ? "chevron-left" : "chevron-right"} />
            <span className="side-text">Collapse</span>
          </button>
        </div>
      </nav>

      <main className="stage" ref={stage}>
        <div className="stage-bar" data-scrolled={scrolled}>
          <span className="stage-title" aria-hidden="true">{current.title}</span>
          <div className="head-actions">{actions}</div>
          <span className="scroll-progress" aria-hidden="true" />
        </div>

        <div className="page" key={section}>
          <header className="page-head">
            <p className="eyebrow">{current.group}</p>
            <h1 ref={heading} tabIndex={-1}>{current.title}</h1>
            <p className="blurb">{current.blurb}</p>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
