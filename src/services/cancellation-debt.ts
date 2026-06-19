import { convert, fetchRates, type CurrencyCode, type ExchangeRates } from "../lib/currency";
import { getAdminSettings } from "../lib/admin-settings";
import { findFirstSuperAdmin } from "../models/superadmin.model";
import {
  incrementAdminCancellationDebt,
  revertAdminCancellationDebt,
} from "../models/admin.model";
import { findProjectById } from "../models/project.model";
import type { CrewTicket } from "../models/crewTicket.model";
import type { Project } from "../models/project.model";

/** Debt and installments use GBP to match `bookFlight` stored `price` / admin `balance`. */
export const CANCELLATION_DEBT_CURRENCY = "GBP" as const;

export function cancellationFeeGbpFromConfig(
  cancellationCharges: number | null | undefined,
  baseCurrency: string,
  rates: ExchangeRates
): number {
  if (cancellationCharges == null || cancellationCharges <= 0) return 0;
  const raw = convert(
    cancellationCharges,
    baseCurrency as CurrencyCode,
    CANCELLATION_DEBT_CURRENCY,
    rates
  );
  return Math.round(raw * 100) / 100;
}

export function cancellationInstallmentGbp(outstanding: number, slots: number): number {
  if (slots <= 0 || outstanding <= 0) return 0;
  return Math.round((outstanding / slots) * 100) / 100;
}

export function cancellationInstallmentInCurrency(
  installmentGbp: number,
  targetCurrency: CurrencyCode,
  rates: ExchangeRates
): number {
  if (installmentGbp <= 0) return 0;
  return Math.round(convert(installmentGbp, CANCELLATION_DEBT_CURRENCY, targetCurrency, rates) * 100) / 100;
}

/**
 * Loads superadmin + settings, converts configured charge to GBP, increments admin debt.
 * @returns fee applied in GBP (0 if skipped) for optional revert on failure.
 */
export async function accrueCancellationDebtForAdmin(adminId: string): Promise<number> {
  const [adminSettings, superAdmin] = await Promise.all([getAdminSettings(), findFirstSuperAdmin()]);
  const charges = superAdmin?.cancellationCharges;
  if (charges == null || charges <= 0) return 0;

  const rates = await fetchRates();
  const baseCurrency = adminSettings.baseCurrency || "GBP";
  const feeGbp = cancellationFeeGbpFromConfig(charges, baseCurrency, rates);
  if (feeGbp <= 0) return 0;

  await incrementAdminCancellationDebt(adminId, feeGbp);
  return feeGbp;
}

export async function revertCancellationAccrual(adminId: string, feeGbp: number): Promise<void> {
  if (feeGbp > 0) {
    await revertAdminCancellationDebt(adminId, feeGbp);
  }
}

/**
 * After a successful book, reduce debt. `billingUnits` = crew tickets created × leg count
 * (round-trip search applies cancellation surcharge per direction, same as markup).
 */
export function applyCancellationPaymentOnBook(
  outstanding: number,
  slots: number,
  billingUnits: number
): { newOutstanding: number; newSlots: number; paymentGbp: number; installmentPerTicketGbp: number } {
  if (slots <= 0 || outstanding <= 0 || billingUnits <= 0) {
    return {
      newOutstanding: Math.max(0, outstanding),
      newSlots: Math.max(0, slots),
      paymentGbp: 0,
      installmentPerTicketGbp: 0,
    };
  }
  const installmentPerTicketGbp = cancellationInstallmentGbp(outstanding, slots);
  const paymentGbp = Math.min(
    outstanding,
    Math.round(installmentPerTicketGbp * billingUnits * 100) / 100
  );
  const newOutstanding = Math.max(0, Math.round((outstanding - paymentGbp) * 100) / 100);
  const newSlots = newOutstanding === 0 ? 0 : Math.max(0, slots - billingUnits);
  return { newOutstanding, newSlots, paymentGbp, installmentPerTicketGbp };
}

export function projectIdStringFromTicket(ticket: CrewTicket): string {
  const p = ticket.project_id;
  if (typeof p === "object" && p && "_id" in (p as object)) {
    return (p as { _id: { toString: () => string } })._id.toString();
  }
  return String(p);
}

export function resolveProjectAdminId(project: Project): string | null {
  const createdBy = project.createdBy;
  if (typeof createdBy === "object" && createdBy && "id" in createdBy) {
    return (createdBy as { id: string }).id;
  }
  if (createdBy) return String(createdBy);
  return null;
}

/**
 * Accrues one cancellation fee unit for the project owner admin.
 * @returns fee applied (GBP) and admin id for revert if delete fails.
 */
export async function accrueCancellationDebtForDeletedCrewTicket(
  ticket: CrewTicket
): Promise<{ feeGbp: number; adminId: string | null }> {
  const project = await findProjectById(projectIdStringFromTicket(ticket));
  if (!project) return { feeGbp: 0, adminId: null };
  const adminId = resolveProjectAdminId(project);
  if (!adminId) return { feeGbp: 0, adminId: null };
  const feeGbp = await accrueCancellationDebtForAdmin(adminId);
  return { feeGbp, adminId };
}
