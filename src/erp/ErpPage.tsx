// Owner: Pablo. Fake ERP. Open at /#/erp (capture) or /#/erp/teach (new hire).
// Every change is published as an ErpEvent so the voice panel can follow along.
// Teach mode loads the newest Work Map and blocks any save that breaks one of its guardrails.
import { useEffect, useRef, useState } from "react";
import { getJson } from "../shared/api";
import { publishErpEvent } from "../shared/bus";
import { violatedGuardrails } from "../shared/guardrails";
import type { ErpEvent, Guardrail, Invoice, WorkMap } from "../shared/types";
import { MasteryPanel } from "../screens/MasteryPanel";
import { recordBlocked, recordSaved, resetProgress } from "../screens/progress";
import "./erp.css";

type Mode = "capture" | "teach";
type TextField = "asset_no" | "note";
type ChoiceField = "cost_center" | "approval" | "status";
/** The form also has a free-text posting note, which is not part of the seed data. */
type Draft = Invoice & { note?: string };

const COST_CENTERS = [
  { value: "4711", label: "4711 · Operating expenses (opex)" },
  { value: "4712", label: "4712 · Office and IT supplies (opex)" },
  { value: "0400", label: "0400 · Capital equipment (capex)" },
];
const APPROVALS = [
  { value: "single", label: "Single approval" },
  { value: "second", label: "Second approval" },
];
const STATUSES = [
  { value: "open", label: "Open" },
  { value: "posted", label: "Posted" },
  { value: "held", label: "Held" },
  { value: "pending_approval", label: "Pending approval" },
];

// Edits survive a reload so a demo run isn't lost; resetErp() restores the seed invoices.
const storeKey = (mode: Mode) => `understudy.erp.${mode}`;

function readEdits(mode: Mode): Record<string, Draft> {
  try {
    return JSON.parse(localStorage.getItem(storeKey(mode)) ?? "{}");
  } catch {
    return {};
  }
}

function writeEdits(mode: Mode, list: Draft[]) {
  try {
    localStorage.setItem(storeKey(mode), JSON.stringify(Object.fromEntries(list.map((i) => [i.id, i]))));
  } catch {
    /* storage blocked: edits live in memory only */
  }
}

export function resetErp() {
  try {
    localStorage.removeItem(storeKey("capture"));
    localStorage.removeItem(storeKey("teach"));
  } catch {
    /* nothing stored */
  }
  resetProgress();
}

/** Newest confirmed real map wins; the hand-made sample is the fallback. */
function pickMap(maps: WorkMap[]): WorkMap | null {
  const byDate = [...maps].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return byDate.find((m) => !m.sample && m.confirmed) ?? byDate.find((m) => !m.sample) ?? byDate[0] ?? null;
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amount);
const statusLabel = (s: string) => STATUSES.find((x) => x.value === s)?.label ?? s;
const publish = (e: Omit<ErpEvent, "t">) => publishErpEvent({ t: Date.now(), ...e });

export function ErpPage({ mode }: { mode: Mode }) {
  const [invoices, setInvoices] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [map, setMap] = useState<WorkMap | null>(null);
  const [blocked, setBlocked] = useState<Guardrail[]>([]);
  const [saved, setSaved] = useState(false);
  const focusValue = useRef<Partial<Record<TextField, string>>>({});
  const lastKeystroke = useRef<Partial<Record<TextField, number>>>({});

  useEffect(() => {
    setDraft(null);
    getJson<Invoice[]>("/api/invoices").then((all) => {
      const edits = readEdits(mode);
      setInvoices(all.filter((i) => i.phase === mode).map((i) => edits[i.id] ?? { ...i, note: "" }));
    });
  }, [mode]);

  // Reload the map when the tab regains focus, so a Gap Loop patch applies without a refresh.
  useEffect(() => {
    if (mode !== "teach") return;
    const load = () => getJson<WorkMap[]>("/api/workmaps").then((maps) => setMap(pickMap(maps)));
    load();
    addEventListener("focus", load);
    return () => removeEventListener("focus", load);
  }, [mode]);

  function open(inv: Draft) {
    setDraft({ ...inv });
    setBlocked([]);
    setSaved(false);
    publish({ type: "invoice_opened", invoice: inv.id });
  }

  function update(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setBlocked([]);
    setSaved(false);
  }

  function choose(field: ChoiceField, value: string) {
    if (!draft || draft[field] === value) return;
    publish({ type: "field_change", invoice: draft.id, field, from: String(draft[field]), to: value });
    update({ [field]: value } as Partial<Draft>);
  }

  // Keystrokes tell the interviewer to stay quiet: at most one event per field per second, never the text.
  function type(field: TextField, value: string) {
    if (!draft) return;
    const now = Date.now();
    if (now - (lastKeystroke.current[field] ?? 0) > 1000) {
      lastKeystroke.current[field] = now;
      publish({ type: "keystroke", invoice: draft.id, field });
    }
    update({ [field]: value } as Partial<Draft>);
  }

  function focus(field: TextField) {
    focusValue.current[field] = draft?.[field] ?? "";
  }

  // Text fields report one field_change when you leave them, not one per letter.
  function blur(field: TextField) {
    if (!draft) return;
    const from = focusValue.current[field];
    const to = draft[field] ?? "";
    if (from !== undefined && from !== to) publish({ type: "field_change", invoice: draft.id, field, from, to });
    delete focusValue.current[field];
  }

  function save() {
    if (!draft) return;
    const before = invoices.find((i) => i.id === draft.id)!;
    const target: Draft = draft.status === "open" ? { ...draft, status: "posted" } : draft;

    const broken = mode === "teach" && map ? violatedGuardrails(target, map.guardrails) : [];
    if (broken.length) {
      broken.forEach((g) => publish({ type: "guardrail_blocked", invoice: draft.id, field: g.id, note: g.text }));
      recordBlocked(draft.id, broken.map((g) => g.id));
      setBlocked(broken);
      return;
    }

    publish({ type: "save", invoice: draft.id, field: "status", from: before.status, to: target.status });
    if (mode === "teach") recordSaved(target);
    const next = invoices.map((i) => (i.id === target.id ? target : i));
    setInvoices(next);
    writeEdits(mode, next);
    setDraft(target);
    setSaved(true);
  }

  return (
    <div className="erp-app">
      <header className="erp-bar">
        <span className="erp-logo">Kessler Maschinenbau</span>
        <span className="erp-mod">Accounts payable · Invoice processing</span>
        <span className={`erp-mode ${mode}`}>{mode === "capture" ? "Expert session" : "Training"}</span>
      </header>

      <div className="erp-body">
        <aside className="erp-list" aria-label="Open invoices">
          <div className="erp-list-head">Invoices ({invoices.length})</div>
          {invoices.map((inv) => (
            <button
              key={inv.id}
              type="button"
              className={`erp-row${draft?.id === inv.id ? " on" : ""}`}
              onClick={() => open(inv)}
            >
              <span className="erp-row-id">{inv.id}</span>
              <span className={`erp-st ${inv.status}`}>{statusLabel(inv.status)}</span>
              <span className="erp-row-sup">{inv.supplier}</span>
              <span className="erp-row-amt">{money(inv.amount, inv.currency)}</span>
            </button>
          ))}
          {mode === "teach" && map && <MasteryPanel map={map} />}
        </aside>

        <section className="erp-detail">
          {!draft ? (
            <p className="erp-empty">Select an invoice to start.</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="erp-title">
                <h1>{draft.id}</h1>
                <span className={`erp-st ${draft.status}`}>{statusLabel(draft.status)}</span>
              </div>

              <dl className="erp-facts">
                <dt>Supplier</dt>
                <dd>
                  {draft.supplier}
                  {!draft.supplier_known && <span className="erp-warn"> · not in vendor master</span>}
                </dd>
                <dt>Country</dt>
                <dd>{draft.country}</dd>
                <dt>Invoice date</dt>
                <dd>{new Date(draft.date).toLocaleDateString("de-DE")}</dd>
                <dt>Description</dt>
                <dd>{draft.description}</dd>
                <dt>Amount</dt>
                <dd className="erp-amt">{money(draft.amount, draft.currency)}</dd>
                <dt>Bank account</dt>
                <dd className="pii" aria-label="Bank account hidden">{draft.iban ?? "n/a"}</dd>
                <dt>Contact</dt>
                <dd className="pii" aria-label="Contact hidden">{draft.contact_name ?? "n/a"}</dd>
              </dl>

              <div className="erp-fields">
                <label>
                  Cost center
                  <select id="f-cost_center" value={draft.cost_center} onChange={(e) => choose("cost_center", e.target.value)}>
                    {COST_CENTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label>
                  Asset number
                  <input
                    id="f-asset_no"
                    value={draft.asset_no}
                    placeholder="e.g. AN-2025-0193"
                    onChange={(e) => type("asset_no", e.target.value)}
                    onFocus={() => focus("asset_no")}
                    onBlur={() => blur("asset_no")}
                  />
                </label>
                <label>
                  Approval
                  <select id="f-approval" value={draft.approval} onChange={(e) => choose("approval", e.target.value)}>
                    {APPROVALS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label>
                  Status
                  <select id="f-status" value={draft.status} onChange={(e) => choose("status", e.target.value)}>
                    {STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="wide">
                  Posting note
                  <textarea
                    id="f-note"
                    rows={2}
                    value={draft.note ?? ""}
                    onChange={(e) => type("note", e.target.value)}
                    onFocus={() => focus("note")}
                    onBlur={() => blur("note")}
                  />
                </label>
              </div>

              {blocked.length > 0 && (
                <div className="erp-blocked" role="alert">
                  <b>Save blocked</b>
                  <ul>
                    {blocked.map((g) => <li key={g.id}>{g.text}</li>)}
                  </ul>
                </div>
              )}

              <div className="erp-actions">
                <button type="submit" className="erp-save">
                  {draft.status === "open" ? "Save and post" : "Save"}
                </button>
                {saved && <span className="erp-ok">Saved as {statusLabel(draft.status).toLowerCase()}</span>}
                {mode === "teach" && map && (
                  <span className="erp-gr">
                    {map.guardrails.length} guardrails from {map.expert}
                  </span>
                )}
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
