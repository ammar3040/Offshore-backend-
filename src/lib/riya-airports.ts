/**
 * Riya Marine airport search via marinecorp.riya.travel.
 * Logs in with RIYA_USERNAME/RIYA_PASSWORD and proxies getcity with session cookies.
 *
 * Uses rejectUnauthorized: false because marinecorp.riya.travel can fail certificate
 * verification in some environments (corporate SSL inspection, incomplete chain, etc.).
 */

import https from "https";

const RIYA_BASE = "https://marinecorp.riya.travel";
const LOGOUT_PATH = "/Authentication/LogOutPage";
const GETCITY_PATH = "/Home/getcity";

const DEFAULT_TIMEOUT_MS = Number(process.env.VITE_API_TIMEOUT) || 30000;

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36";

type HttpsOptions = {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  timeout?: number;
  rejectUnauthorized?: boolean;
};

function httpsRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    timeout?: number;
  } = {}
): Promise<{ statusCode: number; body: string; setCookies: string[] }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Origin: RIYA_BASE,
      Referer: RIYA_BASE + "/",
      ...options.headers,
    };

    const reqOpts: HttpsOptions = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      rejectUnauthorized: false,
      headers,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
    };

    const req = https.request(reqOpts, (res: import("http").IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const setCookies = (res.headers["set-cookie"] as string[]) || [];
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf8"),
          setCookies,
        });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    if (reqOpts.timeout) req.setTimeout(reqOpts.timeout);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function parseCookies(setCookies: string[]): string {
  return setCookies
    .map((s) => s.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

// In-memory session cookies (per document: session storage for server instance)
let sessionCookies: string[] = [];
let cacheExpiry = 0;
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Logout (clear session) before login. Per document: ensures clean state.
 */
async function logoutRiya(): Promise<void> {
  if (sessionCookies.length === 0) return;

  try {
    await httpsRequest(RIYA_BASE + LOGOUT_PATH, {
      method: "GET",
      headers: { Cookie: sessionCookies.join("; ") },
    });
  } catch {
    // Ignore logout errors
  }
  sessionCookies = [];
}

/**
 * Log in to Riya Marine and return session cookie string.
 * Per document: POST to root (/) with USERNAME, PASSWORD, deviceinfo only (no token).
 */
export async function loginRiya(): Promise<string> {
  if (sessionCookies.length > 0 && Date.now() < cacheExpiry) {
    return sessionCookies.join("; ");
  }

  const username = process.env.RIYA_USERNAME;
  const password = process.env.RIYA_PASSWORD;

  if (!username || !password) {
    throw new Error("RIYA_USERNAME and RIYA_PASSWORD must be set in environment.");
  }

  await logoutRiya();

  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2, 18);
  const bodyParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="USERNAME"\r\n\r\n${username}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="PASSWORD"\r\n\r\n${password}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="deviceinfo"\r\n\r\n\r\n`,
    `--${boundary}--\r\n`,
  ];
  const body = Buffer.from(bodyParts.join(""), "utf8");

  const loginRes = await httpsRequest(RIYA_BASE + "/", {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length.toString(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    },
    body,
  });

  const { statusCode, setCookies } = loginRes;

  if (statusCode && statusCode >= 400) {
    throw new Error(`Riya login failed with status ${statusCode}`);
  }

  if (setCookies && setCookies.length > 0) {
    sessionCookies = setCookies.map((c) => c.split(";")[0].trim()).filter(Boolean);
  }

  if (sessionCookies.length === 0) {
    throw new Error("Riya login did not return session cookies.");
  }

  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return sessionCookies.join("; ");
}

const MAX_AUTH_ATTEMPTS = 2;

/**
 * Call getcity with optional session cookies.
 * Per document: re-login and retry when session expired (redirectTo or body contains LogOutPage).
 */
export async function fetchRiyaGetcity(
  query: string,
  cookies?: string,
  attempt = 0
): Promise<{ statusCode: number; body: string; data: unknown }> {
  if (attempt > MAX_AUTH_ATTEMPTS) {
    throw new Error("Max authentication attempts reached");
  }

  const cookieHeader = cookies || (await loginRiya());

  const url = `${RIYA_BASE}${GETCITY_PATH}?Key=${encodeURIComponent(query)}`;
  const getcityRes = await httpsRequest(url, {
    method: "GET",
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
    timeout: DEFAULT_TIMEOUT_MS,
  });

  const { statusCode, body } = getcityRes;

  let data: unknown = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    // Non-JSON response
  }

  // Session expired — re-login and retry
  const needsReLogin =
    (data && typeof data === "object" && (data as Record<string, unknown>).redirectTo === "/Authentication/LogOutPage") ||
    (typeof body === "string" && body.includes("/Authentication/LogOutPage"));

  if (needsReLogin) {
    sessionCookies = [];
    cacheExpiry = 0;
    return fetchRiyaGetcity(query, undefined, attempt + 1);
  }

  return { statusCode, body, data };
}

export interface RiyaAirportItem {
  Name?: string;
  Code?: string;
  COUNTRY?: string;
  COUNTRYNAME?: string;
  CountryCode?: string;
  CountryName?: string;
}

/**
 * Normalize Riya getcity response to Airport[] format.
 * Handles: Items, items, or direct array.
 */
export function normalizeRiyaAirports(data: unknown): RiyaAirportItem[] {
  if (!data || typeof data !== "object") return [];

  const obj = data as Record<string, unknown>;
  let items: RiyaAirportItem[] = [];

  if (Array.isArray(obj)) {
    items = obj as RiyaAirportItem[];
  } else if (Array.isArray(obj.Items)) {
    items = obj.Items as RiyaAirportItem[];
  } else if (Array.isArray(obj.items)) {
    items = obj.items as RiyaAirportItem[];
  } else if (Array.isArray(obj.airports)) {
    items = obj.airports as RiyaAirportItem[];
  } else if (Array.isArray(obj.data)) {
    items = obj.data as RiyaAirportItem[];
  }

  return items;
}
