import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mjml2html = require("mjml") as (mjml: string) => { html: string };
import nodemailer from "nodemailer";
import { fetchCloudinaryAssetBuffer, parseCloudinaryUrl } from "../lib/cloudinary-asset";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
});

function getOnboardingEmailHtml(firstname: string, email: string, password: string): string {
  const templatePath = path.join(process.cwd(), "src", "templates", "emails", "onboardingEmail.mjml");
  const mjmlSource = fs.readFileSync(templatePath, "utf-8");
  const mjmlWithVars = mjmlSource
    .replace(/\{\{firstname\}\}/g, firstname)
    .replace(/\{\{email\}\}/g, email)
    .replace(/\{\{password\}\}/g, password);
  const { html } = mjml2html(mjmlWithVars);
  return html;
}

export async function sendCrewWelcomeEmail(
  to: string,
  firstname: string,
  password: string
): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@marine-flight.com";
  const html = getOnboardingEmailHtml(firstname, to, password);
  await transporter.sendMail({
    from,
    to,
    subject: "Welcome to Marine Flight - Your Crew Account",
    html,
  });
}

export interface FlightItinerarySegment {
  airlineName?: string;
  airlineCode?: string;
  flightNumber?: string;
  from?: string;
  to?: string;
  fromAirport?: string;
  toAirport?: string;
  departureTime?: string;
  arrivalTime?: string;
  cabin?: string;
  baggage?: string;
  cabinBaggage?: string;
}

export interface FlightLeg {
  from?: string;
  to?: string;
  departureTime?: string;
  arrivalTime?: string;
  duration?: string;
  airlineName?: string;
  airlineCode?: string;
  itinerary?: FlightItinerarySegment[];
}

export interface FlightFare {
  totalFare?: number;
  cabin?: string;
  name?: string;
}

export interface FlightTicketData {
  id: string;
  airlineName?: string;
  airlineCode?: string;
  legs: FlightLeg[];
  fares?: FlightFare[];
}

export interface FlightTicketRenderOptions {
  bookingReference?: string;
  passengerName?: string;
  vesselName?: string;
  supportPhone?: string;
  pdfUrl?: string;
}

function formatFlightDateTime(iso?: string): { date: string; time: string } {
  if (!iso) return { date: "—", time: "—" };
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    return { date, time };
  } catch {
    return { date: "—", time: "—" };
  }
}

function formatIssueDate(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).toUpperCase();
}

function formatLayover(startIso?: string, endIso?: string): string | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining.toString().padStart(2, "0")}m`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mimeTypeFromCloudinaryFormat(format?: string): string {
  const ext = (format ?? "pdf").toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

function cloudinaryAttachmentFilename(baseName: string, format?: string): string {
  const ext = (format ?? "pdf").toLowerCase();
  const safe = baseName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}.${ext}`;
}

function airportLabel(full?: string, fallback?: string): string {
  if (!full) return fallback ?? "—";
  const withoutCountry = full.split(",")[0]?.trim() || full;
  const parts = withoutCountry.split(" - ");
  return (parts[1] || parts[0] || fallback || "—").trim();
}

function flightCode(seg: FlightItinerarySegment, leg: FlightLeg, flight: FlightTicketData): string {
  return [
    seg.airlineCode || leg.airlineCode || flight.airlineCode,
    seg.flightNumber,
  ].filter(Boolean).join(" ") || "—";
}

function flattenSegments(flight: FlightTicketData): Array<{ seg: FlightItinerarySegment; leg: FlightLeg }> {
  const flattened: Array<{ seg: FlightItinerarySegment; leg: FlightLeg }> = [];
  flight.legs.forEach((leg) => {
    (leg.itinerary ?? []).forEach((seg) => flattened.push({ seg, leg }));
  });
  if (flattened.length === 0) {
    flight.legs.forEach((leg) => {
      flattened.push({
        leg,
        seg: {
          from: leg.from,
          to: leg.to,
          departureTime: leg.departureTime,
          arrivalTime: leg.arrivalTime,
        },
      });
    });
  }
  return flattened;
}

function buildLynqFlightSections(flight: FlightTicketData): string {
  const flattened = flattenSegments(flight);

  return flattened.map(({ seg, leg }, idx) => {
    const dep = formatFlightDateTime(seg.departureTime || leg.departureTime);
    const arr = formatFlightDateTime(seg.arrivalTime || leg.arrivalTime);
    const code = escapeHtml(flightCode(seg, leg, flight));
    const airline = escapeHtml(seg.airlineName || leg.airlineName || flight.airlineName || "—");
    const fromCode = escapeHtml(seg.from || leg.from || "—");
    const toCode = escapeHtml(seg.to || leg.to || "—");
    const fromAirport = escapeHtml(airportLabel(seg.fromAirport, fromCode));
    const toAirport = escapeHtml(airportLabel(seg.toAirport, toCode));
    const baggage = escapeHtml(seg.baggage || "—");
    const duration = escapeHtml(leg.duration || "—");
    const aircraft = "—";
    const next = flattened[idx + 1]?.seg;
    const layover = next ? formatLayover(seg.arrivalTime || leg.arrivalTime, next.departureTime) : null;
    const layoverSection = layover
      ? `
    <mj-section background-color="#FFF8E8" padding="10px 30px" border="1px solid #C9A84C">
      <mj-column>
        <mj-text padding="0" align="center" css-class="layover-text">
          LAYOVER: ${toAirport} (${toCode}) &nbsp;|&nbsp; STOP DURATION: ${escapeHtml(layover)}
        </mj-text>
      </mj-column>
    </mj-section>`
      : "";

    return `
    <mj-section background-color="#1A3A6B" padding="10px 30px">
      <mj-column width="65%">
        <mj-text padding="0" color="#ffffff">
          <span style="font-size:14px;">&#9992;&nbsp;&nbsp;</span>
          <span style="font-size:12px;font-weight:bold;color:#ffffff;">FLIGHT ${idx + 1}&nbsp;&nbsp;</span>
          <span class="flight-code">${code}</span>
          <span style="font-size:12px;color:#AABBCC;">&nbsp;&nbsp;${airline}</span>
        </mj-text>
      </mj-column>
      <mj-column width="35%">
        <mj-text padding="0" align="right">
          <span class="flight-hdr-label">${escapeHtml(dep.date.toUpperCase())}</span>
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#F5F7FA" padding="16px 30px 8px">
      <mj-column width="30%">
        <mj-text padding="0">
          <span class="iata">${fromCode}</span><br/>
          <span style="font-size:10px;color:#888888;">${fromAirport}</span>
        </mj-text>
      </mj-column>
      <mj-column width="40%">
        <mj-text padding="0" align="center">
          <span style="font-size:11px;color:#BBBBBB;letter-spacing:2px;">----------------</span><br/>
          <span style="font-size:10px;color:#1A3A6B;font-weight:bold;">NON-STOP</span>
        </mj-text>
      </mj-column>
      <mj-column width="30%">
        <mj-text padding="0" align="right">
          <span class="iata">${toCode}</span><br/>
          <span style="font-size:10px;color:#888888;">${toAirport}</span>
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#FFFFFF" padding="10px 30px" border-top="1px solid #EEEEEE">
      <mj-column width="50%" border-right="1px solid #DDDDDD">
        <mj-text padding="0">
          <span class="label">Departure</span><br/>
          <span class="time">${escapeHtml(dep.time)}</span><br/>
          <span style="font-size:11px;color:#1A3A6B;">${escapeHtml(dep.date.toUpperCase())}</span>
        </mj-text>
      </mj-column>
      <mj-column width="50%">
        <mj-text padding="0 0 0 20px">
          <span class="label">Arrival</span><br/>
          <span class="time">${escapeHtml(arr.time)}</span><br/>
          <span style="font-size:11px;color:#1A3A6B;">${escapeHtml(arr.date.toUpperCase())}</span>
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="#EEF2F7" padding="8px 30px">
      <mj-column>
        <mj-text padding="0" align="center" css-class="detail-strip">
          DURATION: ${duration} &nbsp;|&nbsp; AIRCRAFT: ${aircraft} &nbsp;|&nbsp; BAGGAGE: ${baggage} &nbsp;|&nbsp; STATUS: <span class="confirmed">CONFIRMED</span>
        </mj-text>
      </mj-column>
    </mj-section>
    ${layoverSection}`;
  }).join("");
}

function buildItineraryHtml(legs: FlightLeg[]): string {
  const rows: string[] = [];

  legs.forEach((leg, legIdx) => {
    const segments = leg.itinerary ?? [];
    segments.forEach((seg, segIdx) => {
      const dep = formatFlightDateTime(seg.departureTime);
      const arr = formatFlightDateTime(seg.arrivalTime);
      const flightNum = escapeHtml([seg.airlineCode, seg.flightNumber].filter(Boolean).join(" ") || "—");
      const fromCode = escapeHtml(seg.from ?? "—");
      const toCode = escapeHtml(seg.to ?? "—");
      const fromFull = escapeHtml(seg.fromAirport || fromCode);
      const toFull = escapeHtml(seg.toAirport || toCode);
      const cabinVal = escapeHtml(seg.cabin ?? "—");
      const baggageVal = escapeHtml(seg.baggage ?? "—");
      const cabinBagVal = escapeHtml(seg.cabinBaggage ?? "—");
      const segmentLabel = legs.length > 1 || segments.length > 1 ? `Segment ${legIdx + 1}.${segIdx + 1}` : "Flight";

      rows.push(`
        <tr>
          <td style="padding:13px 12px; border-bottom:1px solid #ececf1; color:#111827; font-size:12px; line-height:18px;">
            <strong>${segmentLabel}</strong><br />
            <span style="color:#6b7280;">${flightNum}</span>
          </td>
          <td style="padding:13px 12px; border-bottom:1px solid #ececf1; color:#111827; font-size:12px; line-height:18px;">
            <strong>${fromCode} to ${toCode}</strong><br />
            <span style="color:#6b7280;">${fromFull} / ${toFull}</span>
          </td>
          <td style="padding:13px 12px; border-bottom:1px solid #ececf1; color:#111827; font-size:12px; line-height:18px; text-align:center;">
            <strong>${dep.date}</strong><br />
            <span style="color:#6b7280;">${dep.time} - ${arr.time}</span>
          </td>
          <td style="padding:13px 12px; border-bottom:1px solid #ececf1; color:#111827; font-size:12px; line-height:18px; text-align:right;">
            <strong>${cabinVal}</strong><br />
            <span style="color:#6b7280;">Bag: ${baggageVal} / Cabin: ${cabinBagVal}</span>
          </td>
        </tr>
      `);
    });
  });

  if (rows.length === 0) {
    return '<div style="border:1px solid #ececf1; padding:14px 16px; color:#6b7280; font-size:12px;">No itinerary details available.</div>';
  }

  return `
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
      <tr style="background-color:#4f46e5;">
        <td style="padding:10px 12px; color:#ffffff; font-size:11px; font-weight:800; text-transform:uppercase;">Flight</td>
        <td style="padding:10px 12px; color:#ffffff; font-size:11px; font-weight:800; text-transform:uppercase;">Description</td>
        <td style="padding:10px 12px; color:#ffffff; font-size:11px; font-weight:800; text-transform:uppercase; text-align:center;">Time</td>
        <td style="padding:10px 12px; color:#ffffff; font-size:11px; font-weight:800; text-transform:uppercase; text-align:right;">Details</td>
      </tr>
      ${rows.join("")}
    </table>
  `;
}

export function renderFlightTicketHtml(
  crewFirstname: string,
  flight: FlightTicketData,
  currency: string = "INR",
  options: FlightTicketRenderOptions = {}
): string {
  const templatePath = path.join(process.cwd(), "src", "templates", "emails", "flightTicketEmail.mjml");
  const mjmlSource = fs.readFileSync(templatePath, "utf-8");

  const pdfLinkHtml = options.pdfUrl
    ? `<div style="border:1px solid #ececf1; background:#f9fafb; padding:13px 16px; color:#111827; font-size:12px;"><strong>Your e-ticket PDF:</strong> <a href="${escapeHtml(options.pdfUrl)}" style="color:#4f46e5; text-decoration:underline; font-weight:700;">Download ticket PDF</a></div>`
    : "";

  const firstLeg = flight.legs[0];
  const dep = formatFlightDateTime(firstLeg?.departureTime ?? firstLeg?.itinerary?.[0]?.departureTime);
  const arr = formatFlightDateTime(firstLeg?.arrivalTime ?? firstLeg?.itinerary?.[0]?.arrivalTime);
  const issueDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const totalFare = flight.fares?.[0]?.totalFare ?? 0;
  const cabin = flight.fares?.[0]?.cabin ?? firstLeg?.itinerary?.[0]?.cabin ?? "Economy";
  const origin = firstLeg?.from ?? firstLeg?.itinerary?.[0]?.from ?? "—";
  const dest = firstLeg?.to ?? firstLeg?.itinerary?.[0]?.to ?? "—";
  const fromAirport = firstLeg?.itinerary?.[0]?.fromAirport;
  const toAirport = firstLeg?.itinerary?.[0]?.toAirport;
  const firstSegment = flattenSegments(flight)[0]?.seg;
  const bookingReference = options.bookingReference || flight.id;
  const passengerName = options.passengerName || crewFirstname;
  const vesselName = options.vesselName || "—";
  const baggage = firstSegment?.baggage || "—";
  const routePreview = `${origin} -> ${dest}`;

  const mjmlWithVars = mjmlSource
    .replace(/\{\{crewFirstname\}\}/g, crewFirstname)
    .replace(/\{\{passengerName\}\}/g, escapeHtml(passengerName))
    .replace(/\{\{vesselName\}\}/g, escapeHtml(vesselName))
    .replace(/\{\{bookingReference\}\}/g, escapeHtml(bookingReference))
    .replace(/\{\{issueDate\}\}/g, formatIssueDate())
    .replace(/\{\{issueDateLong\}\}/g, issueDate)
    .replace(/\{\{airlineName\}\}/g, flight.airlineName ?? firstLeg?.airlineName ?? "—")
    .replace(/\{\{origin\}\}/g, fromAirport ? `${fromAirport.split(" - ")[0]?.trim() ?? origin}` : origin)
    .replace(/\{\{destination\}\}/g, toAirport ? `${toAirport.split(" - ")[0]?.trim() ?? dest}` : dest)
    .replace(/\{\{routePreview\}\}/g, escapeHtml(routePreview))
    .replace(/\{\{departureDate\}\}/g, dep.date)
    .replace(/\{\{departureTime\}\}/g, dep.time)
    .replace(/\{\{arrivalDate\}\}/g, arr.date)
    .replace(/\{\{arrivalTime\}\}/g, arr.time)
    .replace(/\{\{duration\}\}/g, firstLeg?.duration ?? "—")
    .replace(/\{\{cabin\}\}/g, cabin)
    .replace(/\{\{meals\}\}/g, "MEAL")
    .replace(/\{\{baggage\}\}/g, escapeHtml(baggage))
    .replace(/\{\{totalFare\}\}/g, String(totalFare))
    .replace(/\{\{currency\}\}/g, currency)
    .replace(/\{\{itineraryHtml\}\}/g, buildItineraryHtml(flight.legs))
    .replace(/\{\{flightSections\}\}/g, buildLynqFlightSections(flight))
    .replace(/\{\{supportPhone\}\}/g, escapeHtml(options.supportPhone || "+91 9619481056"))
    .replace(/\{\{pdfLinkHtml\}\}/g, pdfLinkHtml);

  const { html } = mjml2html(mjmlWithVars);
  return html;
}

/**
 * Sends the flight ticket confirmation email to a crew member.
 */
export async function sendFlightTicketEmail(
  to: string,
  crewFirstname: string,
  flight: FlightTicketData,
  currency: string = "INR",
  pdfUrl?: string,
  options: Omit<FlightTicketRenderOptions, "pdfUrl"> = {}
): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@marine-flight.com";
  const reference = options.bookingReference || flight.id;
  const html = renderFlightTicketHtml(crewFirstname, flight, currency, { ...options, pdfUrl });
  await transporter.sendMail({
    from,
    to,
    subject: `Your Flight Ticket - ${flight.airlineName ?? "Marine Flight"} (Ref: ${reference})`,
    html,
  });
}

/**
 * Sends the admin invoice email with the generated PDF attached.
 * The PDF is downloaded from Cloudinary with signed/authenticated access, then attached as a buffer.
 */
export async function sendAdminInvoiceEmail(args: {
  to: string;
  adminName?: string;
  projectTitle?: string;
  invoiceNumber?: string | null;
  total?: number | null;
  margin?: number | null;
  pdfUrl: string;
}): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@marine-flight.com";
  const greetingName = args.adminName ? escapeHtml(args.adminName) : "there";
  const invoiceNumber = args.invoiceNumber ? escapeHtml(args.invoiceNumber) : "—";
  const projectTitle = args.projectTitle ? escapeHtml(args.projectTitle) : "your project";
  const totalLine =
    typeof args.total === "number"
      ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Total (GBP)</td><td style="padding:8px;border:1px solid #e5e7eb;">£${args.total.toFixed(2)}</td></tr>`
      : "";
  const marginLine =
    typeof args.margin === "number"
      ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Margin (GBP)</td><td style="padding:8px;border:1px solid #e5e7eb;">£${args.margin.toFixed(2)}</td></tr>`
      : "";

  const filename = args.invoiceNumber ? `${args.invoiceNumber}.pdf` : "invoice.pdf";
  const pdfBuffer = await fetchCloudinaryAssetBuffer(args.pdfUrl);

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5;">
      <h2 style="margin:0 0 12px;">Invoice for ${projectTitle}</h2>
      <p>Hi ${greetingName},</p>
      <p>Please find attached the invoice for <strong>${projectTitle}</strong>.</p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;width:100%;max-width:520px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Invoice Number</td><td style="padding:8px;border:1px solid #e5e7eb;">${invoiceNumber}</td></tr>
        ${marginLine}
        ${totalLine}
      </table>
      <p>The full invoice is attached as a PDF.</p>
    </div>`;

  await transporter.sendMail({
    from,
    to: args.to,
    subject: args.invoiceNumber
      ? `Invoice ${args.invoiceNumber} - ${args.projectTitle ?? "Marine Flight"}`
      : `Invoice - ${args.projectTitle ?? "Marine Flight"}`,
    html,
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}

export async function sendTicketApprovalRequestEmail(args: {
  ticketId: string;
  crewName: string;
  projectTitle: string;
  vesselName?: string;
  flight: FlightTicketData;
  currency: string;
  price: number;
  passportNumber?: string;
  passportDocumentUrl?: string;
}): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@marine-flight.com";
  const flattened = flattenSegments(args.flight);
  const rows = flattened.map(({ seg, leg }, idx) => {
    const dep = formatFlightDateTime(seg.departureTime || leg.departureTime);
    const arr = formatFlightDateTime(seg.arrivalTime || leg.arrivalTime);
    return `
      <tr>
        <td style="padding:8px;border:1px solid #e5e7eb;">${idx + 1}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(flightCode(seg, leg, args.flight))}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(seg.from || leg.from || "—")} -> ${escapeHtml(seg.to || leg.to || "—")}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(dep.date)} ${escapeHtml(dep.time)}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(arr.date)} ${escapeHtml(arr.time)}</td>
      </tr>`;
  }).join("");

  const passportRow = args.passportNumber
    ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Passport Number</td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(args.passportNumber)}</td></tr>`
    : "";
  const passportAttachmentNote = args.passportDocumentUrl
    ? "<p>The crew member's passport document is attached to this email.</p>"
    : "";

  const attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }> = [];

  if (args.passportDocumentUrl) {
    try {
      const parsed = parseCloudinaryUrl(args.passportDocumentUrl);
      const passportBuffer = await fetchCloudinaryAssetBuffer(args.passportDocumentUrl);
      attachments.push({
        filename: cloudinaryAttachmentFilename(`passport-${args.crewName}`, parsed?.format),
        content: passportBuffer,
        contentType: mimeTypeFromCloudinaryFormat(parsed?.format),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to attach crew passport to approval email:", error);
    }
  }

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5;">
      <h2 style="margin:0 0 12px;">Crew Ticket Approval Required</h2>
      <p>A crew ticket has been booked and is waiting for superadmin approval.</p>
      ${passportAttachmentNote}
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;width:100%;max-width:720px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Ticket ID</td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(args.ticketId)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Status</td><td style="padding:8px;border:1px solid #e5e7eb;">UNAPPROVED</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Crew</td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(args.crewName)}</td></tr>
        ${passportRow}
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Project</td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(args.projectTitle)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Vessel</td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(args.vesselName || "—")}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;font-weight:bold;">Fare</td><td style="padding:8px;border:1px solid #e5e7eb;">${escapeHtml(args.currency)} ${args.price}</td></tr>
      </table>
      <h3 style="margin:18px 0 8px;">Flight Details</h3>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:900px;">
        <tr style="background:#f3f4f6;">
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">#</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Flight</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Route</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Departure</th>
          <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;">Arrival</th>
        </tr>
        ${rows || `<tr><td colspan="5" style="padding:8px;border:1px solid #e5e7eb;">No flight details available.</td></tr>`}
      </table>
    </div>`;

  await transporter.sendMail({
    from,
    to: "vishwajeetbharadiya12@gmail.com",
    subject: `Crew Ticket Approval Required - ${args.crewName}`,
    html,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}
