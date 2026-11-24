import { useEffect, useRef } from "react";
import { PERMISSION_INFO, type WidgetManifest } from "./manifest";

export default function ConsentDialog(props: {
  manifest: WidgetManifest;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const { manifest, onApprove, onCancel } = props;
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="consent"
      aria-labelledby="consent-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="consent-title">Add {manifest.name}?</h2>
      {manifest.description && <p className="muted">{manifest.description}</p>}
      {manifest.permissions.length === 0 ? (
        <p>This widget doesn’t need any permissions.</p>
      ) : (
        <>
          <p>It will be able to:</p>
          <ul>
            {manifest.permissions.map((p) => (
              <li key={p}>
                <strong>{PERMISSION_INFO[p].title}</strong>
                <span className="muted">{PERMISSION_INFO[p].detail}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="row end">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={onApprove}>Allow and add</button>
      </div>
    </dialog>
  );
}
