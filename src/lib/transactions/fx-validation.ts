import { isPositiveDecimal } from "./fx-decimal";
import { isValidTransactionDate } from "./validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReportingFxFormState = {
  message?: string;
  errors?: Partial<Record<"rate" | "effectiveOn" | "note", string>>;
};

export function validateReportingFxOverride(fields: {
  transactionId: unknown;
  idempotencyKey: unknown;
  rate: unknown;
  effectiveOn: unknown;
  note: unknown;
}):
  | { ok: true; value: { transactionId: string; idempotencyKey: string; rate: string; effectiveOn: string; note: string } }
  | { ok: false; errors: Partial<Record<"rate" | "effectiveOn" | "note", string>> } {
  const errors: Partial<Record<"rate" | "effectiveOn" | "note", string>> = {};
  const transactionId = typeof fields.transactionId === "string" && UUID_PATTERN.test(fields.transactionId) ? fields.transactionId : null;
  const idempotencyKey = typeof fields.idempotencyKey === "string" && UUID_PATTERN.test(fields.idempotencyKey) ? fields.idempotencyKey : null;
  const rate = typeof fields.rate === "string" ? fields.rate.trim() : "";
  const effectiveOn = typeof fields.effectiveOn === "string" ? fields.effectiveOn : "";
  const note = typeof fields.note === "string" ? fields.note.trim() : "";

  if (!isPositiveDecimal(rate)) errors.rate = "Enter a positive decimal rate, for example 150.25.";
  if (!isValidTransactionDate(effectiveOn)) errors.effectiveOn = "Choose a real calendar date.";
  if (note.length === 0 || note.length > 500) errors.note = "Explain the manual reporting rate in 1–500 characters.";
  if (!transactionId || !idempotencyKey) return { ok: false, errors: { ...errors, note: errors.note ?? "This transaction could not be verified." } };
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { transactionId, idempotencyKey, rate, effectiveOn, note } };
}
