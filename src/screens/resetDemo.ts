// Owner: Pablo. One click back to a clean demo between rehearsal runs.
import pristineSample from "../../data/seed/sample-invoice-processing.json";
import { clearRecordings } from "../capture/recordings";
import { resetErp } from "../erp/ErpPage";
import { putJson } from "../shared/api";
import type { WorkMap } from "../shared/types";

/**
 * Restores seed invoices, clears new-hire progress and stored recordings, and puts the
 * sample Work Map back the way it was committed (undoing Quick Ask patches).
 * Work Maps created by capture sessions are kept; the ERP always uses the newest one.
 */
export async function resetDemo() {
  resetErp();
  try {
    localStorage.removeItem("understudy.quickAsk");
  } catch {
    /* nothing stored */
  }
  await clearRecordings().catch(() => {});
  const map = pristineSample as WorkMap;
  await putJson(`/api/workmaps/${map.id}`, map);
}
