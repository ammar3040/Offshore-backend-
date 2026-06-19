import mongoose, { Schema, Document, Model } from "mongoose";
import { ProjectModel } from "./project.model";

export enum AdminInvoiceStatus {
  Draft = "DRAFT",
  Generated = "GENERATED",
  Sent = "SENT",
}

export interface AdminInvoice {
  id: string;
  ticketId: string;
  projectId: string;
  invoiceNumber: string | null;
  margin: number | null;
  total: number | null;
  pdf: string | null;
  status: AdminInvoiceStatus;
  sentAt: string | null;
  createdAt: string;
}

export interface AdminInvoiceDocument
  extends Omit<AdminInvoice, "id" | "ticketId" | "projectId" | "sentAt" | "createdAt">,
    Document {
  _id: mongoose.Types.ObjectId;
  ticketId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Legacy project-level rows lack ticketId and are excluded from API responses. */
const ticketScopedFilter = { ticketId: { $exists: true, $ne: null } };

const adminInvoiceSchema = new Schema<AdminInvoiceDocument>(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "CrewTicket",
      required: true,
      unique: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    invoiceNumber: { type: String, required: false, default: null },
    margin: { type: Number, required: false, default: null },
    total: { type: Number, required: false, default: null },
    pdf: { type: String, required: false, default: null },
    status: {
      type: String,
      enum: Object.values(AdminInvoiceStatus),
      required: true,
      default: AdminInvoiceStatus.Draft,
    },
    sentAt: { type: Date, required: false, default: null },
  },
  { timestamps: true }
);

const AdminInvoiceModel: Model<AdminInvoiceDocument> =
  mongoose.models.AdminInvoice ??
  mongoose.model<AdminInvoiceDocument>("AdminInvoice", adminInvoiceSchema);

function toAdminInvoice(doc: AdminInvoiceDocument): AdminInvoice {
  return {
    id: doc._id.toString(),
    ticketId: doc.ticketId.toString(),
    projectId: doc.projectId.toString(),
    invoiceNumber: doc.invoiceNumber ?? null,
    margin: typeof doc.margin === "number" ? doc.margin : null,
    total: typeof doc.total === "number" ? doc.total : null,
    pdf: doc.pdf ?? null,
    status: (doc.status as AdminInvoiceStatus) ?? AdminInvoiceStatus.Draft,
    sentAt: doc.sentAt ? new Date(doc.sentAt).toISOString() : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : new Date().toISOString(),
  };
}

/** Drop legacy project-level rows and indexes before ticket-scoped unique index sync. */
export async function ensureAdminInvoiceIndexes(): Promise<void> {
  const legacyResult = await AdminInvoiceModel.deleteMany({
    $or: [{ ticketId: { $exists: false } }, { ticketId: null }],
  });
  if (legacyResult.deletedCount > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `Removed ${legacyResult.deletedCount} legacy project-level admin invoice(s) without ticketId.`
    );
  }

  try {
    await AdminInvoiceModel.collection.dropIndex("projectId_1");
  } catch {
    // Index missing or already dropped
  }

  try {
    await AdminInvoiceModel.collection.dropIndex("ticketId_1");
  } catch {
    // Index missing or failed partial build from a prior startup
  }

  await AdminInvoiceModel.syncIndexes();
}

export async function findAllAdminInvoices(): Promise<AdminInvoice[]> {
  const docs = await AdminInvoiceModel.find(ticketScopedFilter).sort({ createdAt: -1 });
  return docs.map((doc) => toAdminInvoice(doc));
}

/** Invoices for projects owned by the given admin (optionally only rows with a PDF). */
export async function findAdminInvoicesByAdminId(
  adminId: string,
  options?: { requirePdf?: boolean }
): Promise<AdminInvoice[]> {
  if (!mongoose.Types.ObjectId.isValid(adminId)) return [];

  const projectDocs = await ProjectModel.find({
    createdBy: new mongoose.Types.ObjectId(adminId),
  }).select("_id");

  const projectIds = projectDocs.map((p) => p._id);
  if (projectIds.length === 0) return [];

  const query: Record<string, unknown> = {
    ...ticketScopedFilter,
    projectId: { $in: projectIds },
  };
  if (options?.requirePdf) {
    query.pdf = { $ne: null, $exists: true };
  }

  const docs = await AdminInvoiceModel.find(query).sort({ createdAt: -1 });
  return docs.map((doc) => toAdminInvoice(doc));
}

export async function findProjectTitlesByIds(
  projectIds: string[]
): Promise<Map<string, string>> {
  const validIds = projectIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) return new Map();

  const docs = await ProjectModel.find({
    _id: { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) },
  }).select("_id title");

  return new Map(docs.map((doc) => [doc._id.toString(), doc.title]));
}

export async function findAdminInvoiceByTicketId(
  ticketId: string
): Promise<AdminInvoice | null> {
  if (!mongoose.Types.ObjectId.isValid(ticketId)) return null;
  const doc = await AdminInvoiceModel.findOne({
    ticketId: new mongoose.Types.ObjectId(ticketId),
  });
  return doc ? toAdminInvoice(doc) : null;
}

/** Upsert (one invoice per crew ticket, keyed on ticketId) and return the full record. */
export async function upsertAdminInvoiceByTicketId(
  ticketId: string,
  projectId: string,
  data: Partial<Pick<AdminInvoice, "invoiceNumber" | "margin" | "total" | "pdf" | "status">> & {
    sentAt?: Date | null;
  }
): Promise<AdminInvoice | null> {
  if (!mongoose.Types.ObjectId.isValid(ticketId) || !mongoose.Types.ObjectId.isValid(projectId)) {
    return null;
  }
  const update: Record<string, unknown> = {};
  if (data.invoiceNumber !== undefined) update.invoiceNumber = data.invoiceNumber;
  if (data.margin !== undefined) update.margin = data.margin;
  if (data.total !== undefined) update.total = data.total;
  if (data.pdf !== undefined) update.pdf = data.pdf;
  if (data.status !== undefined) update.status = data.status;
  if (data.sentAt !== undefined) update.sentAt = data.sentAt;

  const doc = await AdminInvoiceModel.findOneAndUpdate(
    { ticketId: new mongoose.Types.ObjectId(ticketId) },
    {
      $set: update,
      $setOnInsert: {
        ticketId: new mongoose.Types.ObjectId(ticketId),
        projectId: new mongoose.Types.ObjectId(projectId),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc ? toAdminInvoice(doc) : null;
}
