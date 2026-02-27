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
  const labelStyle = "font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:1.2px; font-weight:600; padding-bottom:3px;";
  const valueStyle = "font-size:14px; color:#f1f5f9; font-weight:500;";
  const cards: string[] = [];

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
      const segLabel = legs.length > 1 || segments.length > 1
        ? `<div style="font-size:10px; color:#3b82f6; text-transform:uppercase; letter-spacing:1px; font-weight:700; padding-bottom:12px;">Segment ${legIdx + 1}.${segIdx + 1}</div>`
        : "";

      cards.push(`
        <div style="background:#1e293b; border-radius:12px; padding:20px; margin-bottom:12px;">
          ${segLabel}
          <!-- Flight number + route -->
          <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
            <tr>
              <td style="padding-bottom:16px;" width="50%">
                <div style="${labelStyle}">Flight</div>
                <div style="font-size:16px; color:#60a5fa; font-weight:700;">${flightNum}</div>
              </td>
              <td style="padding-bottom:16px; text-align:right;" width="50%">
                <div style="${labelStyle}">Cabin</div>
                <div style="${valueStyle}">${cabinVal}</div>
              </td>
            </tr>
          </table>
          <!-- From/To -->
          <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse; background:#111827; border-radius:8px; padding:0;">
            <tr>
              <td style="padding:14px 16px;" width="40%">
                <div style="${labelStyle}">From</div>
                <div style="font-size:22px; font-weight:800; color:#f8fafc;">${fromCode}</div>
                <div style="font-size:11px; color:#94a3b8; padding-top:2px;">${dep.date} &middot; ${dep.time}</div>
              </td>
              <td style="text-align:center; padding:14px 4px;" width="20%">
                <div style="color:#3b82f6; font-size:18px;">&#10230;</div>
              </td>
              <td style="padding:14px 16px; text-align:right;" width="40%">
                <div style="${labelStyle}">To</div>
                <div style="font-size:22px; font-weight:800; color:#f8fafc;">${toCode}</div>
                <div style="font-size:11px; color:#94a3b8; padding-top:2px;">${arr.date} &middot; ${arr.time}</div>
              </td>
            </tr>
          </table>
          <!-- Airport names -->
          <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse; padding-top:8px;">
            <tr>
              <td style="padding:10px 0 0; font-size:11px; color:#64748b; line-height:16px;" width="50%">${fromFull}</td>
              <td style="padding:10px 0 0; font-size:11px; color:#64748b; line-height:16px; text-align:right;" width="50%">${toFull}</td>
            </tr>
          </table>
          <!-- Baggage info -->
          <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse; margin-top:14px; border-top:1px solid #334155; padding-top:12px;">
            <tr>
              <td style="padding-top:12px;" width="50%">
                <div style="${labelStyle}">Check-in Baggage</div>
                <div style="${valueStyle}">${baggageVal}</div>
              </td>
              <td style="padding-top:12px;" width="50%">
                <div style="${labelStyle}">Cabin Baggage</div>
                <div style="${valueStyle}">${cabinBagVal}</div>
              </td>
            </tr>
          </table>
        </div>
      `);
    });
  });

  if (cards.length === 0) {
    return '<div style="background:#1e293b; border-radius:12px; padding:20px; color:#94a3b8; font-size:14px;">No itinerary details available.</div>';
  }

  return cards.join("");
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
