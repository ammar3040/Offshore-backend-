import mongoose, { Schema, Document, Model } from "mongoose";

export interface Admin {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  password: string; // hashed password
  phone: string;
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
  };
}

function toAdminPublic(doc: AdminDocument): AdminPublic {
  return {
    id: doc._id.toString(),
    firstname: doc.firstname,
    lastname: doc.lastname,
    email: doc.email,
    phone: doc.phone,
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

export async function createAdmin(data: Omit<Admin, "id">): Promise<AdminPublic> {
  const doc = await AdminModel.create(data);
  return toAdminPublic(doc);
}
