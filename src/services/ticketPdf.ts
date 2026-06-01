import cloudinary, { CLOUDINARY_CREW_TICKET_FOLDER } from "../config/cloudinary";
import { renderFlightTicketHtml, type FlightTicketData, type FlightTicketRenderOptions } from "./email";

export type TicketPdfInput = {
  crewFirstname: string;
  flight: FlightTicketData;
  currency: string;
  renderOptions: FlightTicketRenderOptions;
};

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

async function loadPuppeteer() {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<typeof import("puppeteer")>;
  return importer("puppeteer");
}

export async function generateTicketPdfBuffer(input: TicketPdfInput): Promise<Buffer> {
  const html = renderFlightTicketHtml(
    input.crewFirstname,
    input.flight,
    input.currency,
    input.renderOptions
  );
  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

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

async function uploadPdfBuffer(buffer: Buffer, publicId: string): Promise<string> {
  ensureCloudinaryConfigured();
  const dataUri = `data:application/pdf;base64,${buffer.toString("base64")}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: CLOUDINARY_CREW_TICKET_FOLDER,
    public_id: publicId,
    resource_type: "auto",
  });

  if (!result?.secure_url) {
    throw new Error("Cloudinary did not return a PDF URL.");
  }
  return result.secure_url;
}

/** Optional Cloudinary archive upload — public CDN delivery may still be blocked by account settings. */
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
