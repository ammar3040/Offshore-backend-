import mongoose, { Schema, Document, Model } from "mongoose";
import { ProjectModel } from "./project.model";

export enum AdminInvoiceStatus {
  Draft = "DRAFT",
  Generated = "GENERATED",
  Sent = "SENT",
}

export interface AdminInvoice {
  id: string;
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
  extends Omit<AdminInvoice, "id" | "projectId" | "sentAt" | "createdAt">,
    Document {
  _id: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const adminInvoiceSchema = new Schema<AdminInvoiceDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      unique: true,
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

export async function findAllAdminInvoices(): Promise<AdminInvoice[]> {
  const docs = await AdminInvoiceModel.find().sort({ createdAt: -1 });
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

  const query: Record<string, unknown> = { projectId: { $in: projectIds } };
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

export async function findAdminInvoiceByProjectId(
  projectId: string
): Promise<AdminInvoice | null> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) return null;
  const doc = await AdminInvoiceModel.findOne({ projectId });
  return doc ? toAdminInvoice(doc) : null;
}

/** Upsert (one invoice per project, keyed on projectId) and return the full record. */
export async function upsertAdminInvoiceByProjectId(
  projectId: string,
  data: Partial<Pick<AdminInvoice, "invoiceNumber" | "margin" | "total" | "pdf" | "status">> & {
    sentAt?: Date | null;
  }
): Promise<AdminInvoice | null> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) return null;
  const update: Record<string, unknown> = {};
  if (data.invoiceNumber !== undefined) update.invoiceNumber = data.invoiceNumber;
  if (data.margin !== undefined) update.margin = data.margin;
  if (data.total !== undefined) update.total = data.total;
  if (data.pdf !== undefined) update.pdf = data.pdf;
  if (data.status !== undefined) update.status = data.status;
  if (data.sentAt !== undefined) update.sentAt = data.sentAt;

  const doc = await AdminInvoiceModel.findOneAndUpdate(
    { projectId: new mongoose.Types.ObjectId(projectId) },
    { $set: update, $setOnInsert: { projectId: new mongoose.Types.ObjectId(projectId) } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc ? toAdminInvoice(doc) : null;
}
