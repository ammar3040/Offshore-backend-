import mongoose, { Schema, Document, Model } from "mongoose";
import type { AdminPublic } from "./admin.model";

function isPopulatedAdmin(
  val: unknown
): val is {
  _id: mongoose.Types.ObjectId;
  firstname: string;
  lastname: string;
  email: string;
  phone: string;
  balance: number;
  cancellationOutstanding?: number;
  cancellationSlotsRemaining?: number;
} {
  return (
    val !== null &&
    typeof val === "object" &&
    "_id" in val &&
    "firstname" in val &&
    "email" in val
  );
}

function toAdminPublic(doc: {
  _id: mongoose.Types.ObjectId;
  firstname: string;
  lastname: string;
  email: string;
  phone: string;
  balance: number;
  cancellationOutstanding?: number;
  cancellationSlotsRemaining?: number;
}): AdminPublic {
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

export interface Rig {
  id: string;
  name: string;
  address: string;
  description?: string;
  createdBy: mongoose.Types.ObjectId | AdminPublic;
}

export interface RigDocument extends Omit<Rig, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

const rigSchema = new Schema<RigDocument>(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    description: { type: String, required: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
  },
  { timestamps: true }
);

export const RigModel: Model<RigDocument> =
  mongoose.models.Rig ?? mongoose.model<RigDocument>("Rig", rigSchema);

function toRig(doc: RigDocument): Rig {
  return {
    id: doc._id.toString(),
    name: doc.name,
    address: doc.address,
    description: doc.description,
    createdBy: isPopulatedAdmin(doc.createdBy)
      ? toAdminPublic(doc.createdBy)
      : (doc.createdBy as mongoose.Types.ObjectId),
  };
}

/** Raw document for ownership checks (`createdBy` is always ObjectId). */
export async function findRigDocumentById(id: string): Promise<RigDocument | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return RigModel.findById(id);
}

export async function findRigById(id: string): Promise<Rig | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await RigModel.findById(id).populate("createdBy");
  return doc ? toRig(doc) : null;
}

export async function findAllRigs(filter?: { createdBy?: string | mongoose.Types.ObjectId }): Promise<Rig[]> {
  const query = filter?.createdBy ? { createdBy: filter.createdBy } : {};
  const docs = await RigModel.find(query).sort({ createdAt: -1 }).populate("createdBy");
  return docs.map((d) => toRig(d));
}

export async function createRig(
  data: Omit<Rig, "id"> & { createdBy: mongoose.Types.ObjectId }
): Promise<Rig> {
  const doc = await RigModel.create(data);
  const populated = await RigModel.findById(doc._id).populate("createdBy");
  return toRig(populated ?? doc);
}

export async function updateRig(id: string, data: Partial<Omit<Rig, "id" | "createdBy">>): Promise<Rig | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await RigModel.findByIdAndUpdate(id, data, { new: true }).populate("createdBy");
  return doc ? toRig(doc) : null;
}

export async function deleteRig(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const result = await RigModel.findByIdAndDelete(id);
  return !!result;
}
