// SHARED FILE: two-click delete button. First click asks "Delete? Yes / No"; only "Yes" runs onConfirm.
import { useState } from "react";

export function ConfirmDelete({
  onConfirm,
  label = "Delete",
  what,
}: {
  onConfirm: () => Promise<void> | void;
  label?: string;
  /** Shown in the question, e.g. "this session". */
  what?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking)
    return (
      <button
        type="button"
        className="confirm-delete"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setAsking(true);
        }}
      >
        {label}
      </button>
    );

  return (
    <span className="confirm-delete-ask" onClick={(e) => e.stopPropagation()}>
      <span>Delete{what ? ` ${what}` : ""}? This can't be undone.</span>
      <button
        type="button"
        className="confirm-delete yes"
        disabled={busy}
        onClick={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button
        type="button"
        className="confirm-delete"
        onClick={(e) => {
          e.preventDefault();
          setAsking(false);
        }}
      >
        No
      </button>
    </span>
  );
}
