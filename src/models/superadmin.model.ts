import mongoose, { Schema, Document, Model } from "mongoose";

export interface SuperAdmin {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  password: string; // hashed password
  phone: string;
}

export interface SuperAdminDocument extends Omit<SuperAdmin, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

/** SuperAdmin without password - safe for API responses */
export type SuperAdminPublic = Omit<SuperAdmin, "password">;

const superAdminSchema = new Schema<SuperAdminDocument>(
  {
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true, select: false },
    phone: { type: String, required: true },
  },
  { timestamps: true }
);

const SuperAdminModel: Model<SuperAdminDocument> =
  mongoose.models.SuperAdmin ??
  mongoose.model<SuperAdminDocument>("SuperAdmin", superAdminSchema);

function toSuperAdmin(doc: SuperAdminDocument): SuperAdmin {
  return {
    id: doc._id.toString(),
    firstname: doc.firstname,
    lastname: doc.lastname,
    email: doc.email,
    password: doc.password,
    phone: doc.phone,
  };
}

function toSuperAdminPublic(doc: SuperAdminDocument): SuperAdminPublic {
  return {
    id: doc._id.toString(),
    firstname: doc.firstname,
    lastname: doc.lastname,
    email: doc.email,
    phone: doc.phone,
  };
}

export async function findSuperAdminById(id: string): Promise<SuperAdminPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await SuperAdminModel.findById(id);
  return doc ? toSuperAdminPublic(doc) : null;
}

export async function findSuperAdminByEmail(email: string): Promise<SuperAdmin | null> {
  const doc = await SuperAdminModel.findOne({ email: email.toLowerCase() }).select(
    "+password"
  );
  if (!doc) return null;
  return toSuperAdmin(doc);
}

export async function createSuperAdmin(
  data: Omit<SuperAdmin, "id">
): Promise<SuperAdminPublic> {
  const doc = await SuperAdminModel.create(data);
  return toSuperAdminPublic(doc);
}
