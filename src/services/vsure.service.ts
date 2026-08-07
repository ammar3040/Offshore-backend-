import { VevoMetadata, VisaStatus } from "../types/vevo.types";

/**
 * Live VEVO checks via vSure's Visa Checks API v2 (platform.vsure.com.au).
 *
 * vSure holds the Home Affairs connection; we send passport + date of birth and
 * get the visa record back as JSON. Requires an account: without credentials
 * every call fails fast with VSURE_NOT_CONFIGURED rather than inventing data.
 *
 * Docs: https://developer.vsure.com.au/catalog/visa-checks-api/docs
 */

export interface VsureConfig {
  baseUrl: string;
  apiVersion: string;
  environment: "sandbox" | "production";
  mode: string;
  tokenUrl: string;
  audience: string;
  clientId: string;
  clientSecret: string;
  customerAuthorityId: string;
}

export interface VsureCheckInput {
  fullName?: string;
  dateOfBirth: string;
  passportNumber: string;
  country?: string;
  grantNumber?: string;
}

export class VsureError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, httpStatus = 502, details?: unknown) {
    super(message);
    this.name = "VsureError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

function readConfig(): VsureConfig {
  const environment = (process.env.VSURE_ENVIRONMENT ?? "sandbox").toLowerCase();
  return {
    baseUrl: (process.env.VSURE_BASE_URL ?? "https://platform.vsure.com.au").replace(/\/+$/, ""),
    apiVersion: process.env.VSURE_API_VERSION ?? "2024-03-05",
    environment: environment === "production" ? "production" : "sandbox",
    mode: process.env.VSURE_MODE ?? "fastcheck",
    tokenUrl: process.env.VSURE_TOKEN_URL ?? "",
    audience: process.env.VSURE_AUDIENCE ?? "",
    clientId: process.env.VSURE_CLIENT_ID ?? "",
    clientSecret: process.env.VSURE_CLIENT_SECRET ?? "",
    customerAuthorityId: process.env.VSURE_CUSTOMER_AUTHORITY_ID ?? "",
  };
}

const REQUIRED_KEYS: Array<keyof VsureConfig> = ["tokenUrl", "audience", "clientId", "clientSecret"];

export function missingProviderSettings(): string[] {
  const config = readConfig();
  const envName: Record<string, string> = {
    tokenUrl: "VSURE_TOKEN_URL",
    audience: "VSURE_AUDIENCE",
    clientId: "VSURE_CLIENT_ID",
    clientSecret: "VSURE_CLIENT_SECRET",
  };
  return REQUIRED_KEYS.filter((key) => !String(config[key]).trim()).map((key) => envName[key]!);
}

export function isProviderConfigured(): boolean {
  return missingProviderSettings().length === 0;
}

export function providerStatus() {
  const config = readConfig();
  const missing = missingProviderSettings();
  return {
    provider: "vsure",
    configured: missing.length === 0,
    environment: config.environment,
    mode: config.mode,
    baseUrl: config.baseUrl,
    missingSettings: missing,
  };
}

/**
 * vSure issues 24h Auth0 M2M tokens and caps token creation at 48 per day,
 * so the token is cached and reused across checks.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(config: VsureConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  let response: Response;
  try {
    response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        audience: config.audience,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error: any) {
    throw new VsureError("VSURE_TOKEN_UNREACHABLE", `Could not reach vSure token endpoint: ${error?.message}`, 502);
  }

  const payload = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;

  if (!response.ok || !payload?.access_token) {
    throw new VsureError(
      "VSURE_AUTH_FAILED",
      `vSure rejected the credentials (HTTP ${response.status}). Check VSURE_CLIENT_ID, VSURE_CLIENT_SECRET and VSURE_AUDIENCE.`,
      401,
      payload
    );
  }

  const lifetimeMs = (payload.expires_in ?? 86_400) * 1000;
  cachedToken = { value: payload.access_token, expiresAt: now + lifetimeMs };
  return cachedToken.value;
}

function splitName(fullName?: string): { givenName: string; familyName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "", familyName: "" };
  if (parts.length === 1) return { givenName: parts[0]!, familyName: parts[0]! };
  return { familyName: parts[parts.length - 1]!, givenName: parts.slice(0, -1).join(" ") };
}

async function vsureRequest<T>(config: VsureConfig, path: string, init: RequestInit): Promise<T> {
  const token = await getAccessToken(config);

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: config.apiVersion,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error: any) {
    throw new VsureError("VSURE_UNREACHABLE", `Could not reach vSure: ${error?.message}`, 502);
  }

  const payload = (await response.json().catch(() => null)) as any;

  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail ?? payload?.message ?? `HTTP ${response.status}`;
    // vSure blocks traffic originating outside Australia and New Zealand.
    const code = response.status === 403 ? "VSURE_REGION_BLOCKED" : "VSURE_REQUEST_FAILED";
    throw new VsureError(code, `vSure request failed: ${detail}`, response.status, payload);
  }

  return payload as T;
}

const firstString = (source: Record<string, any> | undefined, keys: string[]): string => {
  if (!source) return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
};

/** Strips the HTML vSure embeds in condition/entitlement text. */
function toPlainText(value: string): string {
  return value
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toIsoDate(value: string): string | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function statusFromResult(code: string, expiryDate: string | null): VisaStatus {
  if (code === "VEVO_NO_VISA") return "Not Found";
  if (code !== "SUCCESS") return "Invalid Request";
  if (!expiryDate) return "Active";
  return new Date(`${expiryDate}T23:59:59Z`).getTime() < Date.now() ? "Expired" : "Active";
}

export interface LiveVevoCheck {
  checkId: string;
  resultCode: string;
  metadata: VevoMetadata;
  raw: unknown;
}

function normalize(input: VsureCheckInput, payload: any): LiveVevoCheck {
  const data = payload?.data ?? payload ?? {};
  const resultCode = String(data?.result?.code ?? "UNKNOWN_ERROR");
  const document = data?.document ?? {};
  const visa = data?.visa?.australia ?? data?.visa ?? {};

  const expiryDate = toIsoDate(
    firstString(visa, ["visa_expiry_date", "expiry_date", "visa_expiry", "date_of_expiry", "expiry", "end_date"])
  );
  const grantDate = toIsoDate(firstString(visa, ["grant_date", "visa_grant_date", "start_date", "visa_start_date"]));

  const applicantName =
    [firstString(document, ["given_name"]), firstString(document, ["family_name"])].filter(Boolean).join(" ") ||
    (input.fullName ?? "").trim();

  const metadata: VevoMetadata = {
    applicantName,
    dateOfBirth: firstString(document, ["date_of_birth"]) || input.dateOfBirth,
    passportNumber: firstString(document, ["identifier", "passport_number"]) || input.passportNumber,
    grantNumber: firstString(visa, ["grant_number", "visa_grant_number"]) || (input.grantNumber ?? ""),
    countryOfDocument: firstString(document, ["country"]) || (input.country ?? ""),
    visaStatus: statusFromResult(resultCode, expiryDate),
    visaClass: firstString(visa, ["class", "visa_class"]),
    visaSubclass: firstString(visa, ["subclass", "type", "visa_subclass", "visa_type"]),
    visaStream: firstString(visa, ["stream", "type_name", "visa_stream"]),
    grantDate,
    expiryDate,
    workEntitlements: toPlainText(
      firstString(visa, ["work_entitlements", "work_entitlement", "work_rights", "entitlements"])
    ),
    visaConditions: toPlainText(firstString(visa, ["visa_conditions", "conditions", "study_entitlements"])),
    periodOfStay: firstString(visa, ["period_of_stay", "stay_period", "must_not_arrive_after"]),
    verifiedAt: firstString(data, ["checked_at", "requested_at"]) || new Date().toISOString(),
  };

  return { checkId: String(data?.id ?? ""), resultCode, metadata, raw: payload };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Checks are asynchronous, so poll until vSure attaches a result code. */
async function waitForResult(config: VsureConfig, checkId: string, initial: any): Promise<any> {
  if (initial?.data?.result?.code) return initial;

  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(attempt === 0 ? 1_200 : 2_000);
    const polled = await vsureRequest<any>(config, `/v2/visa-checks/${checkId}`, { method: "GET" });
    if (polled?.data?.result?.code) return polled;
  }

  throw new VsureError("VSURE_RESULT_TIMEOUT", "vSure did not return a result in time. Retry the check.", 504);
}

export async function runLiveVevoCheck(input: VsureCheckInput): Promise<LiveVevoCheck> {
  const missing = missingProviderSettings();
  if (missing.length > 0) {
    throw new VsureError(
      "VSURE_NOT_CONFIGURED",
      `Live VEVO checks are not configured. Add ${missing.join(", ")} to the backend environment.`,
      503,
      { missingSettings: missing }
    );
  }

  if (!input.dateOfBirth?.trim() || !input.passportNumber?.trim()) {
    throw new VsureError("VSURE_INVALID_INPUT", "Date of birth and passport number are required.", 400);
  }

  const config = readConfig();
  const { givenName, familyName } = splitName(input.fullName);

  const body: Record<string, unknown> = {
    jurisdiction: "AUS",
    environment: config.environment,
    mode: config.mode,
    visa_check_schema: "australia",
    australia: { visa_check_type: "work" },
    document: {
      type: "passport",
      identifier: input.passportNumber.trim(),
      country: (input.country ?? "GBR").trim().toUpperCase(),
      family_name: familyName,
      given_name: givenName,
      date_of_birth: input.dateOfBirth.trim(),
    },
  };

  if (config.customerAuthorityId) body.customer_authority_id = config.customerAuthorityId;

  const created = await vsureRequest<any>(config, "/v2/visa-checks", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const checkId = String(created?.data?.id ?? "");
  if (!checkId) {
    throw new VsureError("VSURE_NO_CHECK_ID", "vSure did not return a check id.", 502, created);
  }

  const settled = await waitForResult(config, checkId, created);
  return normalize(input, settled);
}

export type VisaVerdict = "valid" | "expiring" | "expired" | "unknown";

export interface ExpiryVerdict {
  verdict: VisaVerdict;
  daysRemaining: number | null;
  expiryDate: string | null;
}

export function evaluateExpiry(expiryDate: string | null, expiringWithinDays = 60): ExpiryVerdict {
  if (!expiryDate) return { verdict: "unknown", daysRemaining: null, expiryDate };

  const expiry = new Date(`${expiryDate}T23:59:59Z`).getTime();
  if (Number.isNaN(expiry)) return { verdict: "unknown", daysRemaining: null, expiryDate };

  const daysRemaining = Math.ceil((expiry - Date.now()) / 86_400_000);
  if (daysRemaining < 0) return { verdict: "expired", daysRemaining, expiryDate };
  if (daysRemaining <= expiringWithinDays) return { verdict: "expiring", daysRemaining, expiryDate };
  return { verdict: "valid", daysRemaining, expiryDate };
}
