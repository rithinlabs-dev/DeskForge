import { useMemo } from "react";
import type { ElementLayout, WidgetElementInfo, WidgetLayout } from "./layout";

interface Props {
  name: string;
  elements: WidgetElementInfo[];
  selectedId: string;
  layout: WidgetLayout;
  onSelect: (id: string) => void;
  onChange: (layout: WidgetLayout) => void;
  onClose: () => void;
}

export default function WidgetLayoutEditor({ name, elements, selectedId, layout, onSelect, onChange, onClose }: Props) {
  const orderOf = (element: WidgetElementInfo) => layout[element.id]?.order ?? elements.length - elements.indexOf(element);
  const orderedElements = useMemo(
    () => [...elements].sort((a, b) => orderOf(b) - orderOf(a)),
    [elements, layout],
  );
  const selected = elements.find((element) => element.id === selectedId);
  const selectedLayout = selected ? layout[selected.id] : undefined;

  const baseLayout = (element: WidgetElementInfo): ElementLayout => ({
    x: 0,
    y: 0,
    order: orderOf(element),
    scale: 1,
    opacity: 100,
  });

  const updateSelected = (patch: Partial<ElementLayout>) => {
    if (!selected) return;
    onChange({
      ...layout,
      [selected.id]: { ...baseLayout(selected), ...selectedLayout, ...patch },
    });
  };

  const moveLayer = (id: string, delta: -1 | 1) => {
    const currentOrder = [...orderedElements];
    const index = currentOrder.findIndex((element) => element.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= currentOrder.length) return;
    [currentOrder[index], currentOrder[target]] = [currentOrder[target], currentOrder[index]];
    const next = { ...layout };
    currentOrder.forEach((element, position) => {
      next[element.id] = {
        ...baseLayout(element),
        ...layout[element.id],
        order: currentOrder.length - position,
      };
    });
    onChange(next);
  };

  const range = (label: string, value: number, min: number, max: number, step: number, unit: string, change: (n: number) => void) => (
    <label className="menu-layout-control">
      <span>{label} <code>{Number.isInteger(value) ? value : value.toFixed(2)}{unit}</code></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => change(Number(event.target.value))} />
    </label>
  );

  return (
    <section className="menu-layout-editor" aria-label={`Arrange ${name}`}>
      <header className="menu-layout-head">
        <div>
          <h2>Arrange {name}</h2>
          <p className="muted">Drag outlined items on the desktop. Changes save automatically.</p>
        </div>
        <button className="btn" type="button" onClick={onClose}>Done</button>
      </header>

      <h3>Layers <small>(front to back)</small></h3>
      {orderedElements.length === 0 ? (
        <p className="muted">Waiting for the widget to report its editable elements…</p>
      ) : (
        <ol className="menu-layout-layer-list">
          {orderedElements.map((element, index) => (
            <li key={element.id} className={element.id === selectedId ? "selected" : ""}>
              <button className="menu-layout-layer-select" type="button" onClick={() => onSelect(element.id)} aria-pressed={element.id === selectedId}>
                <span>{element.label}</span>
                <small>{element.kind}</small>
              </button>
              <span className="menu-layout-layer-actions">
                <button className="btn" type="button" disabled={index === 0} onClick={() => moveLayer(element.id, -1)} aria-label={`Move ${element.label} forward`}>↑</button>
                <button className="btn" type="button" disabled={index === orderedElements.length - 1} onClick={() => moveLayer(element.id, 1)} aria-label={`Move ${element.label} backward`}>↓</button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {selected && (
        <div className="menu-layout-properties">
          <h3>{selected.label}</h3>
          {range("Horizontal offset", selectedLayout?.x ?? 0, -100, 100, 1, "%", (x) => updateSelected({ x }))}
          {range("Vertical offset", selectedLayout?.y ?? 0, -100, 100, 1, "%", (y) => updateSelected({ y }))}
          {range("Scale", (selectedLayout?.scale ?? 1) * 100, 25, 300, 5, "%", (scale) => updateSelected({ scale: scale / 100 }))}
          {range("Opacity", selectedLayout?.opacity ?? 100, 0, 100, 1, "%", (opacity) => updateSelected({ opacity }))}
          {selected.kind !== "visual" && (
            <>
              {range("Text size", selectedLayout?.fontSize ?? selected.fontSize, 8, 96, 1, "px", (fontSize) => updateSelected({ fontSize }))}
              <label className="menu-layout-control">
                <span>Text color</span>
                <input type="color" value={selectedLayout?.color ?? selected.color} onChange={(event) => updateSelected({ color: event.target.value })} />
              </label>
              <label className="menu-layout-control">
                <span>Alignment</span>
                <select value={selectedLayout?.align ?? selected.align} onChange={(event) => updateSelected({ align: event.target.value as "left" | "center" | "right" })}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </>
          )}
          <div className="menu-layout-actions">
            <button className="btn" type="button" onClick={() => {
              const next = { ...layout };
              delete next[selected.id];
              onChange(next);
            }}>Reset item</button>
            <button className="btn" type="button" onClick={() => onChange({})}>Reset all</button>
          </div>
        </div>
      )}
    </section>
  );
}
