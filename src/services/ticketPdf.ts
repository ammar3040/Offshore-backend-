import type { Browser } from "puppeteer-core";
import cloudinary, { CLOUDINARY_CREW_TICKET_FOLDER } from "../config/cloudinary";
import { fetchCloudinaryAssetBuffer } from "../lib/cloudinary-asset";
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
const PDF_LAYOUT_STYLES = `
  @page { margin: 0; size: A4; }
  html, body {
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
`;

function prepareTicketHtmlForPdf(html: string): string {
  const styleTag = `<style id="ticket-pdf-layout">${PDF_LAYOUT_STYLES}</style>`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${styleTag}</head>`);
  }
  return `${styleTag}${html}`;
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

async function launchPdfBrowser(): Promise<Browser> {
  const configuredExecutable = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  if (isServerlessRuntime()) {
    const [chromium, puppeteer] = await Promise.all([
      import("@sparticuz/chromium"),
      loadPuppeteerCore(),
    ]);
    return await puppeteer.launch({
      args: [...chromium.default.args, ...SERVERLESS_CHROME_ARGS],
      executablePath: await chromium.default.executablePath(),
      headless: "shell",
    });
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
    const chromium = await import("@sparticuz/chromium");
    try {
      return await puppeteer.launch({
        args: [...chromium.default.args, ...SERVERLESS_CHROME_ARGS],
        executablePath: await chromium.default.executablePath(),
        headless: "shell",
      });
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
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMediaType("screen");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
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

/** Prefer a stored Cloudinary PDF; fall back to on-demand generation. */
export async function resolveCrewTicketPdfBuffer(args: {
  storedPdfUrl?: string;
  generate?: TicketPdfInput;
}): Promise<Buffer> {
  if (args.storedPdfUrl) {
    try {
      return await fetchCloudinaryAssetBuffer(args.storedPdfUrl);
    } catch (storedPdfError) {
      if (!args.generate) {
        throw storedPdfError;
      }
    }
  }

  if (!args.generate) {
    throw new Error("No ticket PDF is available for this booking.");
  }

  return generateTicketPdfBuffer(args.generate);
}

async function uploadPdfBuffer(buffer: Buffer, publicId: string): Promise<string> {
  ensureCloudinaryConfigured();
  const dataUri = `data:application/pdf;base64,${buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: CLOUDINARY_CREW_TICKET_FOLDER,
    public_id: publicId,
    resource_type: "raw",
    type: "upload",
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
