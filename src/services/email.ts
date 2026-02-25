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
  legs.forEach((leg) => {
    const segments = leg.itinerary ?? [];
    segments.forEach((seg) => {
      const dep = formatFlightDateTime(seg.departureTime);
      const arr = formatFlightDateTime(seg.arrivalTime);
      const flightNum = escapeHtml([seg.airlineCode, seg.flightNumber].filter(Boolean).join(" ") || "—");
      const fromLoc = escapeHtml(seg.fromAirport || `${seg.from ?? "—"}`);
      const toLoc = escapeHtml(seg.toAirport || `${seg.to ?? "—"}`);
      const cabinVal = escapeHtml(seg.cabin ?? leg.duration ?? "—");
      rows.push(`
        <tr>
          <td style="padding:12px 16px; border-bottom:1px solid #334155; font-size:14px; color:#94a3b8;">${flightNum}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #334155; font-size:14px; color:#f8fafc;">${fromLoc}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #334155; font-size:14px; color:#f8fafc;">${toLoc}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #334155; font-size:13px; color:#94a3b8;">${dep.date} ${dep.time}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #334155; font-size:13px; color:#94a3b8;">${arr.date} ${arr.time}</td>
          <td style="padding:12px 16px; border-bottom:1px solid #334155; font-size:13px; color:#94a3b8;">${cabinVal}</td>
        </tr>
      `);
    });
  });
  const tableHtml = rows.length === 0
    ? '<table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse; background:#1e293b; border-radius:8px; overflow:hidden; min-width:320px;"><tr><td style="padding:16px; color:#94a3b8;">No itinerary details available.</td></tr></table>'
    : `
    <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse; background:#1e293b; border-radius:8px; overflow:hidden; min-width:480px;">
      <thead>
        <tr style="background:#0f172a;">
          <th style="padding:12px 16px; text-align:left; font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:1px;">Flight</th>
          <th style="padding:12px 16px; text-align:left; font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:1px;">From</th>
          <th style="padding:12px 16px; text-align:left; font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:1px;">To</th>
          <th style="padding:12px 16px; text-align:left; font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:1px;">Departure</th>
          <th style="padding:12px 16px; text-align:left; font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:1px;">Arrival</th>
          <th style="padding:12px 16px; text-align:left; font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:1px;">Cabin</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
  return `<div style="overflow-x:auto; -webkit-overflow-scrolling:touch; margin:0 -4px;">${tableHtml}</div>`;
}

function getFlightTicketEmailHtml(
  crewFirstname: string,
  flight: FlightTicketData,
  currency: string = "INR"
): string {
  const templatePath = path.join(process.cwd(), "src", "templates", "emails", "flightTicketEmail.mjml");
  const mjmlSource = fs.readFileSync(templatePath, "utf-8");

  const firstLeg = flight.legs[0];
  const dep = formatFlightDateTime(firstLeg?.departureTime ?? firstLeg?.itinerary?.[0]?.departureTime);
  const arr = formatFlightDateTime(firstLeg?.arrivalTime ?? firstLeg?.itinerary?.[0]?.arrivalTime);
  const totalFare = flight.fares?.[0]?.totalFare ?? 0;
  const cabin = flight.fares?.[0]?.cabin ?? firstLeg?.itinerary?.[0]?.cabin ?? "Economy";
  const origin = firstLeg?.from ?? firstLeg?.itinerary?.[0]?.from ?? "—";
  const dest = firstLeg?.to ?? firstLeg?.itinerary?.[0]?.to ?? "—";
  const fromAirport = firstLeg?.itinerary?.[0]?.fromAirport;
  const toAirport = firstLeg?.itinerary?.[0]?.toAirport;

  const mjmlWithVars = mjmlSource
    .replace(/\{\{crewFirstname\}\}/g, crewFirstname)
    .replace(/\{\{bookingReference\}\}/g, flight.id)
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
    .replace(/\{\{itineraryHtml\}\}/g, buildItineraryHtml(flight.legs));

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
  currency: string = "INR"
): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@marine-flight.com";
  const html = getFlightTicketEmailHtml(crewFirstname, flight, currency);
  await transporter.sendMail({
    from,
    to,
    subject: `Your Flight Ticket - ${flight.airlineName ?? "Marine Flight"} (Ref: ${flight.id.slice(0, 24)})`,
    html,
  });
}
