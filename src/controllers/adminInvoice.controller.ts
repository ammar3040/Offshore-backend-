import { Response, type Request } from "express";
import mongoose from "mongoose";

import {
  AdminInvoiceStatus,
  findAdminById,
  findAdminInvoiceByTicketId,
  findAdminInvoicesByAdminId,
  findAllAdminInvoices,
  findCrewByCrewId,
  findProjectById,
  findProjectTitlesByIds,
  upsertAdminInvoiceByTicketId,
} from "../models";
import { CrewTicketStatus, findCrewTicketById } from "../models/crewTicket.model";
import type { CrewTicket } from "../models/crewTicket.model";
import type { AuthenticatedRequest } from "../middleware/auth";
import { fetchCloudinaryAssetBuffer, getSignedCloudinaryDeliveryUrl } from "../lib/cloudinary-asset";
import { ACCESS_DENIED_MESSAGE, ticketAccessibleByCaller } from "../lib/resource-access";
import { sendAdminInvoiceEmail } from "../services/email";
import type { AdminInvoice } from "../models/adminInvoice.model";

type AdminInvoiceResponse = AdminInvoice & {
  passengerName?: string;
  projectTitle?: string;
};

/** Parse an optional margin coming from a form field (string) or JSON body (number). */
function parseMargin(raw: unknown): { ok: true; value: number | undefined } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: undefined };
  }
  const value = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false };
  }
  return { ok: true, value: Math.round(value * 100) / 100 };
}

function resolveObjectIdString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object" && value !== null) {
    if ("_id" in value && value._id instanceof mongoose.Types.ObjectId) {
      return value._id.toString();
    }
    if ("id" in value && typeof (value as { id?: unknown }).id === "string") {
      return (value as { id: string }).id;
    }
  }
  if (typeof value === "string") return value;
  return null;
}

function resolveProjectIdFromTicket(ticket: CrewTicket): string | null {
  return resolveObjectIdString(ticket.project_id as mongoose.Types.ObjectId | undefined);
}

function resolveCrewIdFromTicket(ticket: CrewTicket): string | null {
  return resolveObjectIdString(ticket.crew_id as mongoose.Types.ObjectId | undefined);
}

function passengerNameFromTicket(ticket: CrewTicket): string | undefined {
  const crew = ticket.crew_id;
  if (crew && typeof crew === "object" && "firstname" in crew) {
    const populated = crew as { firstname?: string; lastname?: string };
    const name = [populated.firstname, populated.lastname].filter(Boolean).join(" ").trim();
    return name || undefined;
  }
  return undefined;
}

async function resolvePassengerName(ticket: CrewTicket): Promise<string | undefined> {
  const fromPopulate = passengerNameFromTicket(ticket);
  if (fromPopulate) return fromPopulate;

  const crewId = resolveCrewIdFromTicket(ticket);
  if (!crewId) return undefined;

  const crew = await findCrewByCrewId(crewId);
  if (!crew) return undefined;
  const name = [crew.firstname, crew.lastname].filter(Boolean).join(" ").trim();
  return name || undefined;
}

/** Resolve the owning admin (project.createdBy) into { id, email, name }. */
async function resolveProjectAdmin(
  createdBy: unknown
): Promise<{ id: string; email?: string; name?: string } | null> {
  if (
    createdBy &&
    typeof createdBy === "object" &&
    "id" in createdBy &&
    "email" in createdBy
  ) {
    const admin = createdBy as { id: string; email: string; firstname?: string; lastname?: string };
    return {
      id: admin.id,
      email: admin.email,
      name: [admin.firstname, admin.lastname].filter(Boolean).join(" ").trim() || undefined,
    };
  }

  const adminId =
    createdBy instanceof mongoose.Types.ObjectId ? createdBy.toString() : String(createdBy ?? "");
  if (!adminId || !mongoose.Types.ObjectId.isValid(adminId)) return null;
  const admin = await findAdminById(adminId);
  if (!admin) return null;
  return {
    id: admin.id,
    email: admin.email,
    name: [admin.firstname, admin.lastname].filter(Boolean).join(" ").trim() || undefined,
  };
}

function projectTitle(project: { title?: string }): string {
  return project.title || "Project";
}

/** Replace stored Cloudinary URL with a signed delivery URL safe to open in the browser. */
function withSignedPdfUrl<T extends AdminInvoice>(invoice: T): T {
  if (!invoice.pdf) return invoice;
  const signed = getSignedCloudinaryDeliveryUrl(invoice.pdf);
  return signed ? { ...invoice, pdf: signed } : invoice;
}

function invoicePdfFilename(invoice: AdminInvoice, ticketId: string): string {
  return invoice.invoiceNumber ? `${invoice.invoiceNumber}.pdf` : `invoice-${ticketId}.pdf`;
}

async function enrichInvoicesWithPassengerNames(
  invoices: AdminInvoice[]
): Promise<AdminInvoiceResponse[]> {
  const enriched = await Promise.all(
    invoices.map(async (invoice) => {
      const ticket = await findCrewTicketById(invoice.ticketId);
      const passengerName = ticket ? await resolvePassengerName(ticket) : undefined;
      return { ...invoice, passengerName };
    })
  );
  return enriched;
}

async function loadTicketForInvoice(
  ticketId: string
): Promise<
  | { ok: true; ticket: CrewTicket; projectId: string; project: NonNullable<Awaited<ReturnType<typeof findProjectById>>> }
  | { ok: false; status: number; message: string }
> {
  if (!mongoose.Types.ObjectId.isValid(ticketId)) {
    return { ok: false, status: 400, message: "Invalid ticket id." };
  }

  const ticket = await findCrewTicketById(ticketId);
  if (!ticket) {
    return { ok: false, status: 404, message: "Ticket not found." };
  }

  if (ticket.status !== CrewTicketStatus.Approved) {
    return { ok: false, status: 400, message: "Only approved tickets can be invoiced." };
  }

  const projectId = resolveProjectIdFromTicket(ticket);
  if (!projectId) {
    return { ok: false, status: 400, message: "Ticket is not linked to a project." };
  }

  const project = await findProjectById(projectId);
  if (!project) {
    return { ok: false, status: 404, message: "Project not found." };
  }

  return { ok: true, ticket, projectId, project };
}

function ticketSubtotal(ticket: CrewTicket): number {
  return typeof ticket.price === "number" ? ticket.price : 0;
}

/** GET /superadmin/admin-invoices — list all stored invoices. */
export async function listAdminInvoices(_req: AuthenticatedRequest, res: Response) {
  try {
    const adminInvoices = await findAllAdminInvoices();
    const enriched = await enrichInvoicesWithPassengerNames(adminInvoices);
    return res.json({ adminInvoices: enriched.map(withSignedPdfUrl) });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error listing admin invoices:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** GET /admin/admin-invoices — bills for the logged-in admin's projects (with PDF URLs). */
export async function listAdminPanelInvoices(req: AuthenticatedRequest, res: Response) {
  try {
    const adminId = req.user?.userId;
    if (!adminId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const invoices = await findAdminInvoicesByAdminId(adminId, { requirePdf: true });
    const projectTitles = await findProjectTitlesByIds(invoices.map((invoice) => invoice.projectId));
    const enriched = await enrichInvoicesWithPassengerNames(invoices);

    const adminInvoices = enriched.map((invoice) =>
      withSignedPdfUrl({
        ...invoice,
        projectTitle: projectTitles.get(invoice.projectId) ?? undefined,
      })
    );

    return res.json({ adminInvoices });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error listing admin panel invoices:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** POST /superadmin/admin-invoice/:ticketId/upload — store PDF + upsert invoice (status GENERATED). */
export async function uploadAdminInvoicePdf(
  req: AuthenticatedRequest & Request<{ ticketId: string }> & { uploadedPdfUrl?: string },
  res: Response
) {
  try {
    const { ticketId } = req.params;
    const loaded = await loadTicketForInvoice(ticketId);
    if (!loaded.ok) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    const { ticket, projectId } = loaded;

    const pdfUrl = req.uploadedPdfUrl;
    if (!pdfUrl) {
      return res.status(400).json({ message: "PDF upload failed or no file provided." });
    }

    const marginParsed = parseMargin(req.body?.margin);
    if (!marginParsed.ok) {
      return res.status(400).json({ message: "margin must be a number greater than or equal to 0." });
    }

    const existing = await findAdminInvoiceByTicketId(ticketId);
    const margin =
      marginParsed.value !== undefined ? marginParsed.value : existing?.margin ?? null;

    const subtotal = ticketSubtotal(ticket);
    const total = Math.round((subtotal + (margin ?? 0)) * 100) / 100;

    const adminInvoice = await upsertAdminInvoiceByTicketId(ticketId, projectId, {
      pdf: pdfUrl,
      margin,
      total,
      status: AdminInvoiceStatus.Generated,
    });

    const passengerName = await resolvePassengerName(ticket);

    return res.status(200).json({
      message: "Invoice PDF uploaded.",
      adminInvoice: adminInvoice
        ? withSignedPdfUrl({ ...adminInvoice, passengerName })
        : adminInvoice,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error uploading admin invoice PDF:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** POST /superadmin/admin-invoice/:ticketId/send — email the owning admin the stored PDF. */
export async function sendAdminInvoice(
  req: AuthenticatedRequest & Request<{ ticketId: string }>,
  res: Response
) {
  try {
    const { ticketId } = req.params;
    const loaded = await loadTicketForInvoice(ticketId);
    if (!loaded.ok) {
      return res.status(loaded.status).json({ message: loaded.message });
    }

    const { ticket, projectId, project } = loaded;

    const existing = await findAdminInvoiceByTicketId(ticketId);
    if (!existing?.pdf) {
      return res.status(400).json({ message: "No PDF attached for this ticket." });
    }

    const body = (req.body ?? {}) as { margin?: unknown; invoiceNumber?: unknown };

    const marginParsed = parseMargin(body.margin);
    if (!marginParsed.ok) {
      return res.status(400).json({ message: "margin must be a number greater than or equal to 0." });
    }
    const margin =
      marginParsed.value !== undefined ? marginParsed.value : existing.margin ?? null;

    const invoiceNumber =
      typeof body.invoiceNumber === "string" && body.invoiceNumber.trim()
        ? body.invoiceNumber.trim()
        : existing.invoiceNumber ?? null;

    const admin = await resolveProjectAdmin(project.createdBy);
    if (!admin?.email) {
      return res.status(404).json({ message: "Could not resolve the admin email for this project." });
    }

    const subtotal = ticketSubtotal(ticket);
    const total = Math.round((subtotal + (margin ?? 0)) * 100) / 100;

    try {
      await sendAdminInvoiceEmail({
        to: admin.email,
        adminName: admin.name,
        projectTitle: projectTitle(project),
        invoiceNumber,
        total,
        margin,
        pdfUrl: existing.pdf,
      });
    } catch (emailError) {
      // eslint-disable-next-line no-console
      console.error("Error emailing admin invoice:", emailError);
      return res.status(500).json({ message: "Failed to send the invoice email." });
    }

    const adminInvoice = await upsertAdminInvoiceByTicketId(ticketId, projectId, {
      margin,
      invoiceNumber,
      total,
      status: AdminInvoiceStatus.Sent,
      sentAt: new Date(),
    });

    const passengerName = await resolvePassengerName(ticket);

    return res.status(200).json({
      message: "Invoice sent to the admin.",
      adminInvoice: adminInvoice
        ? withSignedPdfUrl({ ...adminInvoice, passengerName })
        : adminInvoice,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error sending admin invoice:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** GET /admin/admin-invoice/:ticketId/pdf — stream invoice PDF (admin owns ticket's project). */
export async function streamAdminPanelInvoicePdf(
  req: AuthenticatedRequest & Request<{ ticketId: string }>,
  res: Response
) {
  try {
    const adminId = req.user?.userId;
    const role = req.user?.role;
    if (!adminId || role !== "admin") {
      return res.status(401).json({ message: "Authentication required." });
    }

    const { ticketId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ message: "Invalid ticket id." });
    }

    const allowed = await ticketAccessibleByCaller(ticketId, adminId, role);
    if (!allowed) {
      const ticket = await findCrewTicketById(ticketId);
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found." });
      }
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const invoice = await findAdminInvoiceByTicketId(ticketId);
    if (!invoice?.pdf) {
      return res.status(404).json({ message: "No PDF attached for this ticket." });
    }

    const pdfBuffer = await fetchCloudinaryAssetBuffer(invoice.pdf);
    const filename = invoicePdfFilename(invoice, ticketId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error streaming admin invoice PDF:", error);
    return res.status(500).json({ message: "Failed to load invoice PDF." });
  }
}

/** GET /superadmin/admin-invoice/:ticketId/pdf — stream invoice PDF (superadmin). */
export async function streamSuperadminInvoicePdf(
  req: AuthenticatedRequest & Request<{ ticketId: string }>,
  res: Response
) {
  try {
    const { ticketId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ message: "Invalid ticket id." });
    }

    const ticket = await findCrewTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found." });
    }

    const invoice = await findAdminInvoiceByTicketId(ticketId);
    if (!invoice?.pdf) {
      return res.status(404).json({ message: "No PDF attached for this ticket." });
    }

    const pdfBuffer = await fetchCloudinaryAssetBuffer(invoice.pdf);
    const filename = invoicePdfFilename(invoice, ticketId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error streaming superadmin invoice PDF:", error);
    return res.status(500).json({ message: "Failed to load invoice PDF." });
  }
}
