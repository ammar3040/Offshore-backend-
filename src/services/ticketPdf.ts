import type { Browser } from "puppeteer-core";
import cloudinary, { CLOUDINARY_CREW_TICKET_FOLDER } from "../config/cloudinary";
import { fetchCloudinaryAssetBuffer } from "../lib/cloudinary-asset";
import { renderFlightTicketHtml, type FlightTicketData, type FlightTicketRenderOptions } from "./email";

export type TicketPdfInput = {
  crewFirstname: string;
  flight: FlightTicketData;
  currency: string;
  renderOptions: FlightTicketRenderOptions;
};

const SERVERLESS_CHROME_ARGS = ["--no-sandbox", "--disable-setuid-sandbox"];

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
  const html = renderFlightTicketHtml(
    input.crewFirstname,
    input.flight,
    input.currency,
    input.renderOptions
  );
  const browser = await launchPdfBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
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
  currency: string;
  renderOptions: FlightTicketRenderOptions;
}): Promise<string> {
  const buffer = await generateTicketPdfBuffer({
    crewFirstname: args.crewFirstname,
    flight: args.flight,
    currency: args.currency,
    renderOptions: args.renderOptions,
  });
  return uploadPdfBuffer(buffer, `crew-ticket-${args.ticketId}-${Date.now()}`);
}
