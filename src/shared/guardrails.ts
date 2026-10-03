// SHARED FILE: evaluates Work Map guardrail checks. Used by the ERP Save hook.
import type { Condition, Guardrail, Invoice } from "./types";

function holds(invoice: Invoice, c: Condition): boolean {
  const actual = invoice[c.field];
  switch (c.op) {
    case "present":
      return actual !== undefined && actual !== null && String(actual).trim() !== "";
    case "eq":
      return String(actual) === String(c.value);
    case "neq":
      return String(actual) !== String(c.value);
    case "gt":
      return Number(actual) > Number(c.value);
    case "lt":
      return Number(actual) < Number(c.value);
    case "contains":
      return String(actual ?? "").includes(String(c.value));
  }
}

/** Guardrails this invoice would break if saved as-is. Empty array = OK to save. */
export function violatedGuardrails(invoice: Invoice, guardrails: Guardrail[]): Guardrail[] {
  return guardrails.filter(
    (g) => g.check && g.check.when.every((c) => holds(invoice, c)) && !holds(invoice, g.check.require),
  );
}
