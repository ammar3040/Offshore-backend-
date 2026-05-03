import mongoose, { Schema, Document, Model } from "mongoose";

export interface Admin {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  password: string; // hashed password
  phone: string;
  balance?: number;
  /** Cancellation debt to recover via search/book surcharges (GBP, same unit as booked ticket price). */
  cancellationOutstanding?: number;
  /** Divisor for installment = outstanding / slots (incremented per cancelled ticket). */
  cancellationSlotsRemaining?: number;
}

export interface AdminDocument extends Omit<Admin, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

/** Admin without password - safe for API responses */
export type AdminPublic = Omit<Admin, "password">;

const adminSchema = new Schema<AdminDocument>(
  {
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true, select: false },
    phone: { type: String, required: true },
    balance: { type: Number, required: true, default: 0 },
    cancellationOutstanding: { type: Number, required: true, default: 0 },
    cancellationSlotsRemaining: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

const AdminModel: Model<AdminDocument> =
  mongoose.models.Admin ?? mongoose.model<AdminDocument>("Admin", adminSchema);

function toAdmin(doc: AdminDocument): Admin {
  return {
    id: doc._id.toString(),
    firstname: doc.firstname,
    lastname: doc.lastname,
    email: doc.email,
    password: doc.password,
    phone: doc.phone,
    balance: doc.balance ?? 0,
    cancellationOutstanding: doc.cancellationOutstanding ?? 0,
    cancellationSlotsRemaining: doc.cancellationSlotsRemaining ?? 0,
  };
}

function toAdminPublic(doc: AdminDocument): AdminPublic {
  return {
    id: doc._id.toString(),
    firstname: doc.firstname,
    lastname: doc.lastname,
    email: doc.email,
    phone: doc.phone,
    balance: doc.balance ?? 0,
    cancellationOutstanding: doc.cancellationOutstanding ?? 0,
    cancellationSlotsRemaining: doc.cancellationSlotsRemaining ?? 0,
  };
}

export async function findAdminById(id: string): Promise<AdminPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await AdminModel.findById(id);
  return doc ? toAdminPublic(doc) : null;
}

export async function findAdminByEmail(email: string): Promise<Admin | null> {
  const doc = await AdminModel.findOne({ email: email.toLowerCase() }).select("+password");
  if (!doc) return null;
  return toAdmin(doc);
}

export async function findAllAdmins(): Promise<AdminPublic[]> {
  const docs = await AdminModel.find().sort({ createdAt: -1 });
  return docs.map((doc) => toAdminPublic(doc));
}

export async function countAdmins(): Promise<number> {
  return AdminModel.countDocuments();
}

export async function createAdmin(data: Omit<Admin, "id">): Promise<AdminPublic> {
  const doc = await AdminModel.create(data);
  return toAdminPublic(doc);
}

export async function updateAdminBalance(adminId: string, newBalance: number): Promise<AdminPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(adminId)) return null;
  const doc = await AdminModel.findByIdAndUpdate(
    adminId,
    { balance: newBalance },
    { new: true }
  );
  return doc ? toAdminPublic(doc) : null;
}

export async function incrementAdminCancellationDebt(
  adminId: string,
  feeGbp: number
): Promise<AdminPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(adminId)) return null;
  if (feeGbp <= 0) return findAdminById(adminId);
  const rounded = Math.round(feeGbp * 100) / 100;
  const doc = await AdminModel.findByIdAndUpdate(
    adminId,
    {
      $inc: {
        cancellationOutstanding: rounded,
        cancellationSlotsRemaining: 1,
      },
    },
    { new: true }
  );
  return doc ? toAdminPublic(doc) : null;
}

/** Undo a single accrual when a follow-up step fails (e.g. delete did not complete). */
export async function revertAdminCancellationDebt(
  adminId: string,
  feeGbp: number
): Promise<AdminPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(adminId)) return null;
  if (feeGbp <= 0) return findAdminById(adminId);
  const rounded = Math.round(feeGbp * 100) / 100;
  const doc = await AdminModel.findByIdAndUpdate(
    adminId,
    {
      $inc: {
        cancellationOutstanding: -rounded,
        cancellationSlotsRemaining: -1,
      },
    },
    { new: true }
  );
  if (!doc) return null;
  const out = Math.max(0, doc.cancellationOutstanding ?? 0);
  const slots = Math.max(0, doc.cancellationSlotsRemaining ?? 0);
  if (out !== doc.cancellationOutstanding || slots !== doc.cancellationSlotsRemaining) {
    return updateAdminCancellationState(adminId, out, slots);
  }
  return toAdminPublic(doc);
}

export async function updateAdminCancellationState(
  adminId: string,
  cancellationOutstanding: number,
  cancellationSlotsRemaining: number
): Promise<AdminPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(adminId)) return null;
  const out = Math.max(0, Math.round(cancellationOutstanding * 100) / 100);
  const slots = Math.max(0, Math.floor(cancellationSlotsRemaining));
  const doc = await AdminModel.findByIdAndUpdate(
    adminId,
    {
      cancellationOutstanding: out,
      cancellationSlotsRemaining: slots,
    },
    { new: true }
  );
  return doc ? toAdminPublic(doc) : null;
}
