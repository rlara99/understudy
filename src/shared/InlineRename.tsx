// SHARED FILE: a name with a small "Rename" button. Click → text field (Enter saves, Esc cancels).
import { useState } from "react";

export function InlineRename({
  value,
  onSave,
  as: Tag = "b",
}: {
  value: string;
  onSave: (name: string) => Promise<void> | void;
  /** Element for the name when not editing (e.g. "b", "h2", "span"). */
  as?: "b" | "h2" | "h3" | "span" | "strong";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const save = async () => {
    const name = draft.replace(/\s+/g, " ").trim();
    if (!name || name === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(name);
      setEditing(false);
    } catch (e) {
      setError(String(e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  if (!editing)
    return (
      <span className="inline-rename">
        <Tag>{value}</Tag>
        <button
          type="button"
          className="inline-rename-btn"
          title="Rename"
          aria-label={`Rename ${value}`}
          onClick={(e) => {
            stop(e);
            setDraft(value);
            setEditing(true);
          }}
        >
          Rename
        </button>
      </span>
    );

  return (
    <span className="inline-rename editing" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={draft}
        maxLength={80}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onClick={stop}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            stop(e);
            save();
          } else if (e.key === "Escape") {
            stop(e);
            setEditing(false);
          }
        }}
      />
      <button
        type="button"
        className="inline-rename-btn save"
        disabled={busy}
        onClick={(e) => {
          stop(e);
          save();
        }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        className="inline-rename-btn"
        onClick={(e) => {
          stop(e);
          setEditing(false);
        }}
      >
        Cancel
      </button>
      {error && <span className="error small">{error}</span>}
    </span>
  );
}
