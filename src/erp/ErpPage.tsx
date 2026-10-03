// Owner: Pablo. Fake ERP. Open at /#/erp (capture) or /#/erp/teach (new hire).
// Every change is published as an ErpEvent so the voice panel can follow along.
import { useEffect, useState } from "react";
import { getJson } from "../shared/api";
import { publishErpEvent } from "../shared/bus";
import type { Invoice } from "../shared/types";

const EDITABLE: (keyof Invoice)[] = ["cost_center", "asset_no", "approval", "status"];

export function ErpPage({ mode }: { mode: "capture" | "teach" }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [current, setCurrent] = useState<Invoice | null>(null);

  useEffect(() => {
    getJson<Invoice[]>("/api/invoices").then((all) => setInvoices(all.filter((i) => i.used_in === mode)));
  }, [mode]);

  const open = (inv: Invoice) => {
    setCurrent({ ...inv });
    publishErpEvent({ t: Date.now(), type: "invoice_opened", invoice: inv.id });
  };

  const change = (field: keyof Invoice, value: string) => {
    if (!current) return;
    publishErpEvent({
      t: Date.now(),
      type: "field_change",
      invoice: current.id,
      field,
      from: String(current[field] ?? ""),
      to: value,
    });
    setCurrent({ ...current, [field]: value });
  };

  const save = () => {
    if (!current) return;
    // TODO (teach mode): load the Work Map, run violatedGuardrails(current, map.guardrails)
    // from ../shared/guardrails. If any, block the save and publish "guardrail_blocked" with note = guardrail text.
    publishErpEvent({ t: Date.now(), type: "save", invoice: current.id });
    setInvoices((all) => all.map((i) => (i.id === current.id ? current : i)));
  };

  return (
    <div className="erp">
      <aside>
        <h2>Open invoices</h2>
        <ul className="list">
          {invoices.map((inv) => (
            <li key={inv.id}>
              <button className={current?.id === inv.id ? "on" : ""} onClick={() => open(inv)}>
                <b>{inv.id}</b> {inv.supplier}
                <span className="muted">
                  {inv.amount.toLocaleString("de-DE")} {inv.currency} · {inv.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section>
        {current ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            onKeyDown={() => publishErpEvent({ t: Date.now(), type: "keystroke", invoice: current.id })}
          >
            <h2>{current.id}</h2>
            <dl className="facts">
              <dt>Supplier</dt>
              <dd>
                {current.supplier} ({current.supplier_country})
              </dd>
              <dt>Description</dt>
              <dd>{current.description}</dd>
              <dt>Amount</dt>
              <dd>
                {current.amount.toLocaleString("de-DE")} {current.currency}
              </dd>
              <dt>Date</dt>
              <dd>{current.date}</dd>
              <dt>IBAN</dt>
              <dd className="pii">{current.iban ?? "n/a"}</dd>
              <dt>Contact</dt>
              <dd className="pii">{current.contact ?? "n/a"}</dd>
            </dl>
            {EDITABLE.map((field) => (
              <label key={field}>
                {field}
                <input
                  id={`f-${field}`}
                  value={String(current[field] ?? "")}
                  onChange={(e) => change(field, e.target.value)}
                />
              </label>
            ))}
            <button type="submit">Save</button>
          </form>
        ) : (
          <p className="muted">Pick an invoice on the left.</p>
        )}
      </section>
    </div>
  );
}
