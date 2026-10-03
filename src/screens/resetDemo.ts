// Owner: Pablo. One click back to a clean demo between rehearsal runs.
import pristineSample from "../../data/seed/sample-invoice-processing.json";
import { postControl } from "../capture/control";
import { clearRecordings } from "../capture/recordings";
import { putJson } from "../shared/api";
import type { WorkMap } from "../shared/types";
import { resetProgressView } from "./progress";

/**
 * Tells the separate ERP app to restore its seed invoices and clear the trainee's progress
 * (relay message), clears stored recordings, and puts the sample Work Map back the way it was
 * committed (undoing Quick Ask patches). Work Maps created by capture sessions are kept.
 */
export async function resetDemo() {
  postControl({ kind: "reset" });
  resetProgressView();
  try {
    localStorage.removeItem("understudy.quickAsk");
    localStorage.removeItem("understudy.myQuestions");
  } catch {
    /* nothing stored */
  }
  await Promise.all([
    clearRecordings().catch(() => {}),
    putJson(`/api/workmaps/${(pristineSample as WorkMap).id}`, pristineSample),
  ]);
}
