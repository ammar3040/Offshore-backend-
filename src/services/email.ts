import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mjml2html = require("mjml") as (mjml: string) => { html: string };
import nodemailer from "nodemailer";

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function getFlightTicketEmailHtml(
  crewFirstname: string,
  flight: FlightTicketData,
  currency: string = "INR",
  pdfUrl?: string
): string {
  const templatePath = path.join(process.cwd(), "src", "templates", "emails", "flightTicketEmail.mjml");
  const mjmlSource = fs.readFileSync(templatePath, "utf-8");

  const pdfLinkHtml = pdfUrl
    ? `<div style="border:1px solid #ececf1; background:#f9fafb; padding:13px 16px; color:#111827; font-size:12px;"><strong>Your e-ticket PDF:</strong> <a href="${escapeHtml(pdfUrl)}" style="color:#4f46e5; text-decoration:underline; font-weight:700;">Download ticket PDF</a></div>`
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

  const mjmlWithVars = mjmlSource
    .replace(/\{\{crewFirstname\}\}/g, crewFirstname)
    .replace(/\{\{bookingReference\}\}/g, flight.id)
    .replace(/\{\{issueDate\}\}/g, issueDate)
    .replace(/\{\{airlineName\}\}/g, flight.airlineName ?? firstLeg?.airlineName ?? "—")
    .replace(/\{\{origin\}\}/g, fromAirport ? `${fromAirport.split(" - ")[0]?.trim() ?? origin}` : origin)
    .replace(/\{\{destination\}\}/g, toAirport ? `${toAirport.split(" - ")[0]?.trim() ?? dest}` : dest)
    .replace(/\{\{departureDate\}\}/g, dep.date)
    .replace(/\{\{departureTime\}\}/g, dep.time)
    .replace(/\{\{arrivalDate\}\}/g, arr.date)
    .replace(/\{\{arrivalTime\}\}/g, arr.time)
    .replace(/\{\{duration\}\}/g, firstLeg?.duration ?? "—")
    .replace(/\{\{cabin\}\}/g, cabin)
    .replace(/\{\{totalFare\}\}/g, String(totalFare))
    .replace(/\{\{currency\}\}/g, currency)
    .replace(/\{\{itineraryHtml\}\}/g, buildItineraryHtml(flight.legs))
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
  pdfUrl?: string
): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@marine-flight.com";
  const html = getFlightTicketEmailHtml(crewFirstname, flight, currency, pdfUrl);
  await transporter.sendMail({
    from,
    to,
    subject: `Your Flight Ticket - ${flight.airlineName ?? "Marine Flight"} (Ref: ${flight.id.slice(0, 24)})`,
    html,
  });
}
