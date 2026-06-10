import type { Browser } from "puppeteer-core";
import path from "path";
import cloudinary, { CLOUDINARY_CREW_TICKET_FOLDER } from "../config/cloudinary";
import { fetchCloudinaryAssetBuffer } from "../lib/cloudinary-asset";
import "../lib/trace-serverless-pdf-deps";
import { renderFlightTicketHtml, type FlightTicketData, type FlightTicketRenderOptions } from "./email";

export type TicketPdfInput = {
  crewFirstname: string;
  flight: FlightTicketData;
  renderOptions: FlightTicketRenderOptions;
};

const SERVERLESS_CHROME_ARGS = ["--no-sandbox", "--disable-setuid-sandbox"];

/**
 * MJML lays out columns with `@media only screen` rules, but Puppeteer PDF defaults
 * to print media — columns then stay at inline `width:100%` and stack vertically.
 */
/** A4 page height at 96dpi — used to fit content on a single page. */
const A4_HEIGHT_PX = 1123;

const PDF_LAYOUT_STYLES = `
  @page { margin: 0; size: A4; }
  html, body.ticket-pdf {
    margin: 0 !important;
    padding: 0 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  div[style*="max-width:600px"] {
    max-width: 100% !important;
    width: 100% !important;
    margin: 0 !important;
  }
  .mj-column-per-60,
  .mj-column-per-40,
  .mj-column-per-65,
  .mj-column-per-35,
  .mj-column-per-30,
  .mj-column-per-50,
  .mj-column-per-25,
  .mj-column-per-100 {
    display: inline-block !important;
    vertical-align: top !important;
  }
  .mj-column-per-60 { width: 60% !important; max-width: 60% !important; }
  .mj-column-per-40 { width: 40% !important; max-width: 40% !important; }
  .mj-column-per-65 { width: 65% !important; max-width: 65% !important; }
  .mj-column-per-35 { width: 35% !important; max-width: 35% !important; }
  .mj-column-per-30 { width: 30% !important; max-width: 30% !important; }
  .mj-column-per-50 { width: 50% !important; max-width: 50% !important; }
  .mj-column-per-25 { width: 25% !important; max-width: 25% !important; }
  .mj-column-per-100 { width: 100% !important; max-width: 100% !important; }
  body.ticket-pdf .label { font-size: 8px !important; letter-spacing: 0.5px !important; }
  body.ticket-pdf .value { font-size: 11px !important; }
  body.ticket-pdf .iata { font-size: 22px !important; line-height: 1.1 !important; }
  body.ticket-pdf .time { font-size: 16px !important; line-height: 1.1 !important; }
  body.ticket-pdf .flight-code { font-size: 12px !important; }
  body.ticket-pdf .flight-hdr-label { font-size: 8px !important; }
  body.ticket-pdf .detail-strip,
  body.ticket-pdf .layover-text { font-size: 9px !important; }
  body.ticket-pdf span[style*="font-size:28px"] { font-size: 22px !important; }
  body.ticket-pdf span[style*="font-size:22px"] { font-size: 17px !important; }
  body.ticket-pdf span[style*="font-size:16px"] { font-size: 13px !important; }
  body.ticket-pdf span[style*="font-size:14px"] { font-size: 11px !important; }
  body.ticket-pdf span[style*="font-size:12px"] { font-size: 10px !important; }
  body.ticket-pdf span[style*="font-size:11px"] { font-size: 9px !important; }
  body.ticket-pdf span[style*="font-size:10px"] { font-size: 8px !important; }
  body.ticket-pdf td[style*="padding:24px"] { padding: 12px 24px 10px !important; }
  body.ticket-pdf td[style*="padding:16px 30px 14px"] { padding: 8px 24px 6px !important; }
  body.ticket-pdf td[style*="padding:12px 30px"] { padding: 6px 24px !important; }
  body.ticket-pdf td[style*="padding:16px 30px 8px"] { padding: 8px 24px 4px !important; }
  body.ticket-pdf td[style*="padding:10px 30px"] { padding: 5px 24px !important; }
  body.ticket-pdf td[style*="padding:8px 30px"] { padding: 4px 24px !important; }
  body.ticket-pdf td[style*="padding:18px 30px 16px"] { padding: 8px 24px 6px !important; }
  body.ticket-pdf td[style*="padding:8px 0"] { padding: 0 !important; }
  body.ticket-pdf .ticket-pdf-spacer,
  body.ticket-pdf .ticket-pdf-pdf-link { display: none !important; }
`;

function prepareTicketHtmlForPdf(html: string): string {
  let pdfHtml = html.replace(
    /<body([^>]*)>/i,
    '<body class="ticket-pdf"$1>'
  );
  // Drop vertical spacer bands and the empty PDF-download row (email-only).
  pdfHtml = pdfHtml.replace(
    /<div[^>]*background-color:#EAEEF4[^>]*>\s*<table[\s\S]*?padding:8px 0[\s\S]*?<\/div>/gi,
    '<div class="ticket-pdf-spacer"></div>'
  );
  pdfHtml = pdfHtml.replace(
    /<div[^>]*background-color:#EAEEF4[^>]*>\s*<table[\s\S]*?padding:0 30px 12px[\s\S]*?<\/div>/gi,
    '<div class="ticket-pdf-pdf-link"></div>'
  );

  const styleTag = `<style id="ticket-pdf-layout">${PDF_LAYOUT_STYLES}</style>`;
  if (pdfHtml.includes("</head>")) {
    return pdfHtml.replace("</head>", `${styleTag}</head>`);
  }
  return `${styleTag}${pdfHtml}`;
}

async function resolveSinglePagePdfScale(page: Awaited<ReturnType<Browser["newPage"]>>): Promise<number> {
  const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  if (contentHeight <= A4_HEIGHT_PX) {
    return 1;
  }
  // Leave a small buffer so footers never clip onto page 2.
  return Math.min(0.95, (A4_HEIGHT_PX - 8) / contentHeight);
}

function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function ensureCloudinaryConfigured(): void {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET."
    );
  }
}

async function loadPuppeteerCore() {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<typeof import("puppeteer-core")>;
  return importer("puppeteer-core");
}

async function loadFullPuppeteer() {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<typeof import("puppeteer")>;
  return importer("puppeteer");
}

/** Avoid TS compiling dynamic import() to require() — @sparticuz/chromium is ESM-only. */
async function loadSparticuzChromium() {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<typeof import("@sparticuz/chromium")>;
  const chromiumModule = await importer("@sparticuz/chromium");
  return chromiumModule.default;
}

export type TicketPdfResolveResult = {
  buffer: Buffer;
  /** Set when a fresh PDF was generated and uploaded to Cloudinary. */
  uploadedPdfUrl?: string;
};

async function launchServerlessBrowser(
  chromium: typeof import("@sparticuz/chromium").default,
  puppeteer: typeof import("puppeteer-core")
): Promise<Browser> {
  chromium.setGraphicsMode = false;
  const binDir = path.join(process.cwd(), "node_modules/@sparticuz/chromium/bin");
  let executablePath: string;
  try {
    executablePath = await chromium.executablePath(binDir);
  } catch {
    executablePath = await chromium.executablePath();
  }
  return puppeteer.launch({
    args: [...chromium.args, ...SERVERLESS_CHROME_ARGS],
    executablePath,
    headless: true,
  });
}

async function launchPdfBrowser(): Promise<Browser> {
  const configuredExecutable = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  if (isServerlessRuntime()) {
    const [chromium, puppeteer] = await Promise.all([
      loadSparticuzChromium(),
      loadPuppeteerCore(),
    ]);
    return launchServerlessBrowser(chromium, puppeteer);
  }

  if (configuredExecutable) {
    const puppeteer = await loadPuppeteerCore();
    return await puppeteer.launch({
      executablePath: configuredExecutable,
      headless: true,
      args: SERVERLESS_CHROME_ARGS,
    });
  }

  try {
    const puppeteer = await loadFullPuppeteer();
    return await puppeteer.launch({
      headless: true,
      args: SERVERLESS_CHROME_ARGS,
    });
  } catch (bundledChromeError) {
    const puppeteer = await loadPuppeteerCore();
    const chromium = await loadSparticuzChromium();
    try {
      return launchServerlessBrowser(chromium, puppeteer);
    } catch {
      throw bundledChromeError;
    }
  }
}

export async function generateTicketPdfBuffer(input: TicketPdfInput): Promise<Buffer> {
  const html = prepareTicketHtmlForPdf(
    renderFlightTicketHtml(input.crewFirstname, input.flight, input.renderOptions)
  );
  const browser = await launchPdfBrowser();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: A4_HEIGHT_PX });
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMediaType("screen");
    const scale = await resolveSinglePagePdfScale(page);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      scale,
      margin: {
        top: "0px",
        right: "0px",
        bottom: "0px",
        left: "0px",
      },
    });
    const buffer = Buffer.from(pdf);
    if (buffer.length < 5 || buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
      throw new Error("Generated ticket is not a valid PDF.");
    }
    return buffer;
  } finally {
    await browser.close();
  }
}

/** Prefer a stored Cloudinary PDF; regenerate, upload, and return when missing or stale. */
export async function resolveCrewTicketPdfBuffer(args: {
  storedPdfUrl?: string;
  generate?: TicketPdfInput;
  /** When set, freshly generated PDFs are uploaded and this URL is returned for DB persistence. */
  persistTicketId?: string;
}): Promise<TicketPdfResolveResult> {
  if (args.storedPdfUrl) {
    try {
      const buffer = await fetchCloudinaryAssetBuffer(args.storedPdfUrl);
      return { buffer };
    } catch (storedPdfError) {
      if (!args.generate) {
        throw storedPdfError;
      }
    }
  }

  if (!args.generate) {
    throw new Error("No ticket PDF is available for this booking.");
  }

  const buffer = await generateTicketPdfBuffer(args.generate);
  if (!args.persistTicketId) {
    return { buffer };
  }

  try {
    const uploadedPdfUrl = await uploadPdfBuffer(
      buffer,
      `crew-ticket-${args.persistTicketId}-${Date.now()}`
    );
    return { buffer, uploadedPdfUrl };
  } catch (uploadError) {
    // eslint-disable-next-line no-console
    console.error("Failed to upload regenerated ticket PDF:", uploadError);
    return { buffer };
  }
}

async function uploadPdfBuffer(buffer: Buffer, publicId: string): Promise<string> {
  ensureCloudinaryConfigured();
  const dataUri = `data:application/pdf;base64,${buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: CLOUDINARY_CREW_TICKET_FOLDER,
    public_id: publicId,
    resource_type: "raw",
    type: "upload",
    access_mode: "public",
    format: "pdf",
  });

  if (!result?.secure_url) {
    throw new Error("Cloudinary did not return a PDF URL.");
  }
  return result.secure_url;
}

/** Optional Cloudinary archive upload — use authenticated download endpoints for delivery. */
export async function generateAndUploadTicketPdf(args: {
  ticketId: string;
  crewFirstname: string;
  flight: FlightTicketData;
  renderOptions: FlightTicketRenderOptions;
}): Promise<string> {
  const buffer = await generateTicketPdfBuffer({
    crewFirstname: args.crewFirstname,
    flight: args.flight,
    renderOptions: args.renderOptions,
  });
  return uploadPdfBuffer(buffer, `crew-ticket-${args.ticketId}-${Date.now()}`);
}
