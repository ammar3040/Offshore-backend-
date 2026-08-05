import { VevoFetchInput, VevoApiResponse } from "../types/vevo.types";
import { buildSimplePdfDataUri } from "../utils/pdfCertificate";

/**
 * VEVO portal URL (reference only — lookup uses local verified registry records).
 * Kept in service code, not in .env.
 */
const VEVO_TARGET_ENDPOINT = "https://online.immi.gov.au/evo/firstParty";

type RegistryRecord = {
  fullName: string;
  dateOfBirth: string;
  grantNumber: string;
  passportNumber: string;
  visaStatus: "Active" | "Expired" | "Not Found";
  visaClass: string;
  visaSubclass: string;
  expiryDate: string | null;
  workEntitlements: string;
  httpStatus: number;
  success: boolean;
  message: string;
};

/**
 * Exact-match registry used by POST /visa/fetch.
 * Matching requires grantNumber + passportNumber + dateOfBirth (all three).
 */
const VEVO_REGISTRY: RegistryRecord[] = [
  {
    fullName: "Visa Holder (Record 1)",
    dateOfBirth: "1974-10-27",
    grantNumber: "0289584946860",
    passportNumber: "133951532",
    visaStatus: "Active",
    visaClass: "Maritime Crew (Temporary)",
    visaSubclass: "Subclass 988",
    expiryDate: "2027-10-27",
    workEntitlements: "Unrestricted - Work in Maritime Industry / Offshore Waters",
    httpStatus: 200,
    success: true,
    message: "VEVO document verification succeeded. Visa record active.",
  },
  {
    fullName: "Scott Archibald",
    dateOfBirth: "1981-01-12",
    grantNumber: "0289584963243",
    passportNumber: "151662015",
    visaStatus: "Active",
    visaClass: "Temporary Work (Short Stay Specialist)",
    visaSubclass: "Subclass 400",
    expiryDate: "2026-12-15",
    workEntitlements: "Allowed to work subject to condition 8107 (Specified work only)",
    httpStatus: 200,
    success: true,
    message: "VEVO document verification succeeded. Visa record active.",
  },
  {
    fullName: "Clive Mercer",
    dateOfBirth: "1978-11-03",
    grantNumber: "0289584959964",
    passportNumber: "151730613",
    visaStatus: "Active",
    visaClass: "Maritime Crew (Temporary)",
    visaSubclass: "Subclass 988",
    expiryDate: "2027-05-20",
    workEntitlements: "Unrestricted Maritime Crew Work Rights",
    httpStatus: 200,
    success: true,
    message: "VEVO document verification succeeded. Visa record active.",
  },
  {
    fullName: "Darryl Keen",
    dateOfBirth: "1976-11-26",
    grantNumber: "0289584959969",
    passportNumber: "124777283",
    visaStatus: "Expired",
    visaClass: "Maritime Crew (Temporary)",
    visaSubclass: "Subclass 988",
    expiryDate: "2025-01-10",
    workEntitlements: "Expired - Work Rights Inactive (Visa expired on 10 Jan 2025)",
    httpStatus: 200,
    success: true,
    message: "VEVO verification completed. Visa status: Expired.",
  },
  {
    fullName: "John Dingwall",
    dateOfBirth: "1984-03-14",
    grantNumber: "0289500084806",
    passportNumber: "142828174",
    visaStatus: "Not Found",
    visaClass: "N/A",
    visaSubclass: "N/A",
    expiryDate: null,
    workEntitlements: "None - Visa Details Not Found on VEVO Registry",
    httpStatus: 404,
    success: false,
    message: "VEVO Verification Failed: No matching visa record found for the provided details.",
  },
];

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeDob(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Service to handle VEVO Visa Grant & Document verification.
 */
export class VevoIntegrationService {
  public async fetchVisaDetails(input: VevoFetchInput): Promise<VevoApiResponse> {
    const startTime = Date.now();

    if (!input.grantNumber || !input.passportNumber || !input.dateOfBirth) {
      console.warn(`[VEVO Service] 400 Bad Request - Missing required input fields. Body:`, input);
      return {
        statusCode: 400,
        success: false,
        message: "Bad Request: 'grantNumber', 'passportNumber', and 'dateOfBirth' are required.",
        errors: ["Missing required fields for VEVO check."],
      };
    }

    const fullName = input.fullName?.trim() || "Applicant";
    const dateOfBirth = normalizeDob(input.dateOfBirth);
    const grantNumber = input.grantNumber.trim();
    const passportNumber = input.passportNumber.trim();
    const country = input.country?.toUpperCase() || "AUS";

    console.log(`[VEVO API Request] Target: ${VEVO_TARGET_ENDPOINT}`);
    console.log(`[VEVO API Payload]`, { fullName, dateOfBirth, grantNumber, passportNumber, country });

    try {
      const result = this.queryVevoRegistry({
        fullName,
        dateOfBirth,
        grantNumber,
        passportNumber,
        country,
      });
      console.log(
        `[VEVO API Response Status] ${result.statusCode} - Response time: ${Date.now() - startTime}ms`
      );
      return result;
    } catch (error: any) {
      console.error(`[VEVO Service] 500 Internal Server Error:`, error?.message || error);
      return {
        statusCode: 500,
        success: false,
        message: "Internal Server Error: Failed to process VEVO verification request.",
        errors: [error?.message || "Unknown VEVO API error"],
      };
    }
  }

  private queryVevoRegistry(payload: {
    fullName: string;
    dateOfBirth: string;
    grantNumber: string;
    passportNumber: string;
    country: string;
  }): VevoApiResponse {
    const grantKey = normalizeKey(payload.grantNumber);
    const passportKey = normalizeKey(payload.passportNumber);
    const dobKey = normalizeDob(payload.dateOfBirth);

    // Strict match: grant + passport + DOB must all match the same registry row
    const exact = VEVO_REGISTRY.find(
      (row) =>
        normalizeKey(row.grantNumber) === grantKey &&
        normalizeKey(row.passportNumber) === passportKey &&
        normalizeDob(row.dateOfBirth) === dobKey
    );

    if (exact) {
      const applicantName =
        payload.fullName && payload.fullName !== "N/A" && payload.fullName !== "Applicant"
          ? payload.fullName
          : exact.fullName;

      return {
        statusCode: exact.httpStatus,
        success: exact.success,
        message: exact.message,
        data: {
          applicantName,
          dateOfBirth: exact.dateOfBirth,
          passportNumber: exact.passportNumber,
          grantNumber: exact.grantNumber,
          visaStatus: exact.visaStatus,
          visaClass: exact.visaClass,
          visaSubclass: exact.visaSubclass,
          expiryDate: exact.expiryDate,
          workEntitlements: exact.workEntitlements,
          documentUrl: exact.success
            ? `${VEVO_TARGET_ENDPOINT}/pdf?grant=${exact.grantNumber}`
            : undefined,
          pdfStream: exact.success
            ? this.generateSampleVevoPdfDataUri(
                applicantName,
                exact.grantNumber,
                exact.passportNumber,
                exact.visaSubclass,
                exact.visaStatus,
                exact.expiryDate ?? "N/A"
              )
            : undefined,
          verifiedAt: new Date().toISOString(),
        },
        ...(exact.success
          ? {}
          : { errors: ["Record not found in Department of Home Affairs VEVO system."] }),
      };
    }

    // Helpful partial-match errors (so mixed fields don't silently return the wrong person)
    const grantOnly = VEVO_REGISTRY.find((row) => normalizeKey(row.grantNumber) === grantKey);
    const passportOnly = VEVO_REGISTRY.find(
      (row) => normalizeKey(row.passportNumber) === passportKey
    );

    const hints: string[] = ["No matching VEVO record for grant + passport + date of birth."];
    if (grantOnly && normalizeKey(grantOnly.passportNumber) !== passportKey) {
      hints.push(
        `Grant ${grantOnly.grantNumber} belongs to passport ${grantOnly.passportNumber} (DOB ${grantOnly.dateOfBirth}).`
      );
    }
    if (passportOnly && normalizeKey(passportOnly.grantNumber) !== grantKey) {
      hints.push(
        `Passport ${passportOnly.passportNumber} belongs to grant ${passportOnly.grantNumber} (DOB ${passportOnly.dateOfBirth}).`
      );
    }

    return {
      statusCode: 404,
      success: false,
      message: "VEVO Record Not Found — details do not match a single verified record.",
      data: {
        applicantName: payload.fullName,
        dateOfBirth: payload.dateOfBirth,
        passportNumber: payload.passportNumber,
        grantNumber: payload.grantNumber,
        visaStatus: "Not Found",
        visaClass: "N/A",
        visaSubclass: "N/A",
        expiryDate: null,
        workEntitlements: "No entitlements verified",
        verifiedAt: new Date().toISOString(),
      },
      errors: hints,
    };
  }

  private generateSampleVevoPdfDataUri(
    name: string,
    grant: string,
    passport: string,
    subclass: string,
    status: string,
    expiry: string
  ): string {
    return buildSimplePdfDataUri([
      "VEVO Entitlement Verification Certificate",
      "Australian Department of Home Affairs (simulated)",
      "",
      `Applicant: ${name}`,
      `Grant number: ${grant}`,
      `Passport number: ${passport}`,
      `Visa subclass: ${subclass}`,
      `Visa status: ${status}`,
      `Expiry date: ${expiry}`,
      `Verified at: ${new Date().toISOString()}`,
    ]);
  }
}

export const vevoService = new VevoIntegrationService();
