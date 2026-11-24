import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { ElementLayout, WidgetElementInfo, WidgetLayout } from "./layout";

interface Props {
  elements: WidgetElementInfo[];
  selectedId: string;
  layout: WidgetLayout;
  onSelect: (id: string) => void;
  onChange: (layout: WidgetLayout) => void;
}

interface DragState {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  baseX: number;
  baseY: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export default function WidgetLayoutHandles({ elements, selectedId, layout, onSelect, onChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const baseLayout = (element: WidgetElementInfo): ElementLayout => ({
    x: 0,
    y: 0,
    order: layout[element.id]?.order ?? elements.length - elements.indexOf(element),
    scale: 1,
    opacity: 100,
  });

  const onTargetDown = (element: WidgetElementInfo) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const stage = stageRef.current;
    if (!stage || stage.clientWidth <= 0 || stage.clientHeight <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(element.id);
    const current = layout[element.id] ?? baseLayout(element);
    drag.current = {
      id: element.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: stage.clientWidth,
      height: stage.clientHeight,
      baseX: current.x,
      baseY: current.y,
    };
  };

  const onTargetMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
    const element = elements.find((item) => item.id === currentDrag.id);
    if (!element) return;
    const current = layout[element.id] ?? baseLayout(element);
    onChange({
      ...layout,
      [element.id]: {
        ...current,
        x: clamp(currentDrag.baseX + (event.clientX - currentDrag.startX) / currentDrag.width * 100, -100, 100),
        y: clamp(currentDrag.baseY + (event.clientY - currentDrag.startY) / currentDrag.height * 100, -100, 100),
      },
    });
  };

  return (
    <div className="dw-layout-overlay" ref={stageRef} role="group" aria-label="Widget layout handles">
      {elements.map((element) => (
        <button
          key={element.id}
          className={`dw-layout-target${element.id === selectedId ? " selected" : ""}`}
          style={{
            left: element.x,
            top: element.y,
            width: element.width,
            height: element.height,
            zIndex: (layout[element.id]?.order ?? elements.length - elements.indexOf(element)) + 1,
          }}
          type="button"
          aria-label={element.label}
          aria-pressed={element.id === selectedId}
          title={`Drag to move ${element.label}`}
          onClick={() => onSelect(element.id)}
          onPointerDown={onTargetDown(element)}
          onPointerMove={onTargetMove}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
        />
      ))}
    </div>
  );
}
