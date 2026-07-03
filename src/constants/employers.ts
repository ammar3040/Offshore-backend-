/** Standard employer dropdown values (MD Section 6 — EmployerEnum). */
export const EMPLOYER_VALUES = [
  "Subseaquence",
  "GES",
  "SBS",
  "RTC",
  "Ogenus",
  "Synnrgi",
  "SUB-C",
  // TODO: confirm with client — see MD Section 9 #1 (doc1: "Direct with Client" vs proposal: "Direct with Operator")
  "Direct with Operator",
  "Self-Employed",
  "Other",
] as const;

export type EmployerValue = (typeof EMPLOYER_VALUES)[number];

export const EMPLOYER_OTHER: EmployerValue = "Other";

export function isKnownEmployer(value: string): value is EmployerValue {
  return (EMPLOYER_VALUES as readonly string[]).includes(value);
}

/** Persist employer: enum value, or free-text when Other is selected. */
export function resolveEmployerForStorage(
  employer: string,
  employerOther?: string
): { ok: true; value: string } | { ok: false; message: string } {
  if (!employer?.trim()) {
    return { ok: false, message: "employer is required when marking unavailability with assignment details." };
  }
  if (!isKnownEmployer(employer)) {
    return {
      ok: false,
      message: `employer must be one of: ${EMPLOYER_VALUES.join(", ")}`,
    };
  }
  if (employer === EMPLOYER_OTHER) {
    const text = employerOther?.trim();
    if (!text) {
      return { ok: false, message: "employer_other is required when employer is Other." };
    }
    return { ok: true, value: text };
  }
  return { ok: true, value: employer };
}

/** Split stored employer back into enum + optional other text for API responses. */
export function formatEmployerForResponse(stored: string | undefined): {
  employer?: string;
  employer_other?: string;
} {
  if (!stored) return {};
  if (isKnownEmployer(stored)) {
    return { employer: stored };
  }
  return { employer: EMPLOYER_OTHER, employer_other: stored };
}
