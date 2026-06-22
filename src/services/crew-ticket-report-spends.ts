import { CabinClass } from "../models/crewTicket.model";
import type { CrewTicketReportSpendsRow } from "../models/crewTicket.model";

/** Calendar month boundaries for report spends (GBP business; matches UK admin expectations). */
export const REPORT_SPENDS_TIMEZONE = "Europe/London";

export interface ReportSpendsResponse {
  scope: {
    projectId: string;
    bookingsInScope: number;
    currency: "GBP";
    timezone: typeof REPORT_SPENDS_TIMEZONE;
  };
  mtd: {
    month: string;
    totalSpend: number;
    pricedBookings: number;
    averageTicketCost: number;
    topCabinClass: string | null;
  };
  comparison: {
    previousMonth: string;
    previousMonthTotalSpend: number;
    percentChange: number;
    direction: "up" | "down" | "flat";
  };
  spendByDestination: Array<{ label: string; amount: number; bookingCount: number }>;
  bookingsByClass: Array<{ label: string; count: number; percent: number }>;
  summary: {
    destinationCount: number;
  };
}

interface MonthRange {
  year: number;
  month: number;
  start: Date;
  end: Date;
  label: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getZonedParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { year, month, day };
}

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const zoned = new Date(date.toLocaleString("en-US", { timeZone }));
  return zoned.getTime() - utc.getTime();
}

function localMidnightToUtc(year: number, month: number, day: number, timeZone: string): Date {
  let utcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  for (let i = 0; i < 3; i += 1) {
    const offset = getTimezoneOffsetMs(new Date(utcMs), timeZone);
    utcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offset;
  }
  return new Date(utcMs);
}

function monthRange(year: number, month: number, timeZone: string): MonthRange {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return {
    year,
    month,
    start: localMidnightToUtc(year, month, 1, timeZone),
    end: localMidnightToUtc(nextYear, nextMonth, 1, timeZone),
    label: `${year}-${pad2(month)}`,
  };
}

function currentAndPreviousMonthRanges(
  referenceDate: Date,
  timeZone: string
): { current: MonthRange; previous: MonthRange } {
  const { year, month } = getZonedParts(referenceDate, timeZone);
  const current = monthRange(year, month, timeZone);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const previous = monthRange(prevYear, prevMonth, timeZone);
  return { current, previous };
}

function isPricedTicket(price: unknown): price is number {
  return typeof price === "number" && !Number.isNaN(price);
}

function destinationLabel(to: CrewTicketReportSpendsRow["to"]): string {
  const name = to?.COUNTRYNAME?.trim();
  if (name) return name;
  const country = to?.COUNTRY?.trim();
  if (country) return country;
  return "Unknown destination";
}

const CABIN_CLASS_LABELS: Record<CabinClass, string> = {
  [CabinClass.Economy]: "Economy",
  [CabinClass.PremiumEconomy]: "Premium Economy",
  [CabinClass.Business]: "Business",
  [CabinClass.FirstClass]: "First Class",
};

function normalizeCabinClass(value: string): string {
  if (value in CABIN_CLASS_LABELS) {
    return CABIN_CLASS_LABELS[value as CabinClass];
  }
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isInRange(createdAt: Date, range: MonthRange): boolean {
  const ts = createdAt.getTime();
  return ts >= range.start.getTime() && ts < range.end.getTime();
}

function sumPricedSpend(tickets: CrewTicketReportSpendsRow[]): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const ticket of tickets) {
    if (!isPricedTicket(ticket.price)) continue;
    total += ticket.price;
    count += 1;
  }
  return { total, count };
}

function topCabinClassByCount(
  tickets: CrewTicketReportSpendsRow[],
  pricedOnly: boolean
): string | null {
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    if (pricedOnly && !isPricedTicket(ticket.price)) continue;
    const label = normalizeCabinClass(ticket.class);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let top: string | null = null;
  let topCount = 0;
  for (const [label, count] of counts) {
    if (count > topCount) {
      top = label;
      topCount = count;
    }
  }
  return top;
}

function percentChange(current: number, previous: number): number {
  if (previous > 0) {
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }
  if (current > 0) return 100;
  return 0;
}

function spendDirection(change: number): "up" | "down" | "flat" {
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "flat";
}

export function buildReportSpendsFromTickets(
  tickets: CrewTicketReportSpendsRow[],
  options: { projectId?: string; referenceDate?: Date } = {}
): ReportSpendsResponse {
  const referenceDate = options.referenceDate ?? new Date();
  const { current, previous } = currentAndPreviousMonthRanges(referenceDate, REPORT_SPENDS_TIMEZONE);

  const mtdTickets = tickets.filter((t) => isInRange(t.createdAt, current));
  const previousMonthTickets = tickets.filter((t) => isInRange(t.createdAt, previous));

  const mtdSpend = sumPricedSpend(mtdTickets);
  const previousMonthSpend = sumPricedSpend(previousMonthTickets);
  const change = percentChange(mtdSpend.total, previousMonthSpend.total);

  const destinationTotals = new Map<string, { amount: number; bookingCount: number }>();
  for (const ticket of tickets) {
    if (!isPricedTicket(ticket.price)) continue;
    const label = destinationLabel(ticket.to);
    const row = destinationTotals.get(label) ?? { amount: 0, bookingCount: 0 };
    row.amount += ticket.price;
    row.bookingCount += 1;
    destinationTotals.set(label, row);
  }

  const spendByDestination = [...destinationTotals.entries()]
    .map(([label, row]) => ({ label, amount: row.amount, bookingCount: row.bookingCount }))
    .sort((a, b) => b.amount - a.amount);

  const classCounts = new Map<string, number>();
  for (const ticket of tickets) {
    const label = normalizeCabinClass(ticket.class);
    classCounts.set(label, (classCounts.get(label) ?? 0) + 1);
  }

  const bookingsInScope = tickets.length;
  const bookingsByClass = [...classCounts.entries()]
    .map(([label, count]) => ({
      label,
      count,
      percent: bookingsInScope > 0 ? Math.round((count / bookingsInScope) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    scope: {
      projectId: options.projectId ?? "all",
      bookingsInScope,
      currency: "GBP",
      timezone: REPORT_SPENDS_TIMEZONE,
    },
    mtd: {
      month: current.label,
      totalSpend: mtdSpend.total,
      pricedBookings: mtdSpend.count,
      averageTicketCost:
        mtdSpend.count > 0 ? Math.round((mtdSpend.total / mtdSpend.count) * 100) / 100 : 0,
      topCabinClass: topCabinClassByCount(mtdTickets, true),
    },
    comparison: {
      previousMonth: previous.label,
      previousMonthTotalSpend: previousMonthSpend.total,
      percentChange: change,
      direction: spendDirection(change),
    },
    spendByDestination,
    bookingsByClass,
    summary: {
      destinationCount: destinationTotals.size,
    },
  };
}
