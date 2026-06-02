import { Response, type Request } from "express";
import mongoose from "mongoose";

import {
  AdminInvoiceStatus,
  findAdminById,
  findAdminInvoiceByProjectId,
  findAdminInvoicesByAdminId,
  findAllAdminInvoices,
  findProjectById,
  findProjectTitlesByIds,
  sumApprovedTicketPriceByProject,
  upsertAdminInvoiceByProjectId,
} from "../models";
import type { AuthenticatedRequest } from "../middleware/auth";
import { sendAdminInvoiceEmail } from "../services/email";

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

/** GET /superadmin/admin-invoices — list all stored invoices. */
export async function listAdminInvoices(_req: AuthenticatedRequest, res: Response) {
  try {
    const adminInvoices = await findAllAdminInvoices();
    return res.json({ adminInvoices });
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

    const adminInvoices = invoices.map((invoice) => ({
      ...invoice,
      projectTitle: projectTitles.get(invoice.projectId) ?? undefined,
    }));

    return res.json({ adminInvoices });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error listing admin panel invoices:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** POST /superadmin/admin-invoice/:projectId/upload — store PDF + upsert invoice (status GENERATED). */
export async function uploadAdminInvoicePdf(
  req: AuthenticatedRequest & Request<{ projectId: string }> & { uploadedPdfUrl?: string },
  res: Response
) {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ message: "Invalid project id." });
    }

    const project = await findProjectById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const pdfUrl = req.uploadedPdfUrl;
    if (!pdfUrl) {
      return res.status(400).json({ message: "PDF upload failed or no file provided." });
    }

    const marginParsed = parseMargin(req.body?.margin);
    if (!marginParsed.ok) {
      return res.status(400).json({ message: "margin must be a number greater than or equal to 0." });
    }

    const existing = await findAdminInvoiceByProjectId(projectId);
    const margin =
      marginParsed.value !== undefined ? marginParsed.value : existing?.margin ?? null;

    const subtotal = await sumApprovedTicketPriceByProject(projectId);
    const total = Math.round((subtotal + (margin ?? 0)) * 100) / 100;

    const adminInvoice = await upsertAdminInvoiceByProjectId(projectId, {
      pdf: pdfUrl,
      margin,
      total,
      status: AdminInvoiceStatus.Generated,
    });

    return res.status(200).json({
      message: "Invoice PDF uploaded.",
      adminInvoice,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error uploading admin invoice PDF:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}

/** POST /superadmin/admin-invoice/:projectId/send — email the owning admin the stored PDF. */
export async function sendAdminInvoice(
  req: AuthenticatedRequest & Request<{ projectId: string }>,
  res: Response
) {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ message: "Invalid project id." });
    }

    const project = await findProjectById(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    const existing = await findAdminInvoiceByProjectId(projectId);
    if (!existing?.pdf) {
      return res.status(400).json({ message: "No PDF attached for this project." });
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

    const subtotal = await sumApprovedTicketPriceByProject(projectId);
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

    const adminInvoice = await upsertAdminInvoiceByProjectId(projectId, {
      margin,
      invoiceNumber,
      total,
      status: AdminInvoiceStatus.Sent,
      sentAt: new Date(),
    });

    return res.status(200).json({
      message: "Invoice sent to the admin.",
      adminInvoice,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error sending admin invoice:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
}
