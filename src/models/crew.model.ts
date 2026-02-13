import mongoose, { Schema, Document, Model } from "mongoose";

export enum IdentityType {
  NationalId = "national_id",
  DrivingLicense = "driving_license",
  IdentityNumber = "identity_number",
}

export interface Passport {
  passport_number: string;
  issue_date: string;
  expiry_date: string;
  issuing_country: string;
  passport_document: string;
}

export interface Identity {
  identity_type: IdentityType;
  identity_number: string;
  issue_date: string;
  expiry_date: string;
  identity_document: string;
}

export interface Crew {
  id: string;
  firstname: string;
  lastname: string;
  dateOfBirth: string;
  nationality: string;
  gender: string;
  email: string;
  phone: string;
  alternate_phone: string;
  address: string;
  city: string;
  country: string;
  postal_code: string;
  password: string; // hashed
  passport: Passport;
  identity: Identity;
}

// Mongoose document type (has _id)
export interface CrewDocument extends Omit<Crew, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

const passportSchema = new Schema<Passport>(
  {
    passport_number: { type: String, required: true },
    issue_date: { type: String, required: true },
    expiry_date: { type: String, required: true },
    issuing_country: { type: String, required: true },
    passport_document: { type: String, required: true },
  },
  { _id: false }
);

const identitySchema = new Schema<Identity>(
  {
    identity_type: { type: String, enum: Object.values(IdentityType), required: true },
    identity_number: { type: String, required: true },
    issue_date: { type: String, required: true },
    expiry_date: { type: String, required: true },
    identity_document: { type: String, required: true },
  },
  { _id: false }
);

const crewSchema = new Schema<CrewDocument>(
  {
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    dateOfBirth: { type: String, required: true },
    nationality: { type: String, required: true },
    gender: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    alternate_phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    postal_code: { type: String, required: true },
    password: { type: String, required: true, select: false },
    passport: { type: passportSchema, required: true },
    identity: { type: identitySchema, required: true },
  },
  { timestamps: true }
);

const CrewModel: Model<CrewDocument> =
  mongoose.models.Crew ?? mongoose.model<CrewDocument>("Crew", crewSchema);

/** Crew without password - safe for API responses */
export type CrewPublic = Omit<Crew, "password">;

function toCrew(doc: CrewDocument): CrewPublic {
  return {
    id: doc._id.toString(),
    firstname: doc.firstname,
    lastname: doc.lastname,
    dateOfBirth: doc.dateOfBirth,
    nationality: doc.nationality,
    gender: doc.gender,
    email: doc.email,
    phone: doc.phone,
    alternate_phone: doc.alternate_phone,
    address: doc.address,
    city: doc.city,
    country: doc.country,
    postal_code: doc.postal_code,
    passport: doc.passport,
    identity: doc.identity,
  };
}

export async function findCrewById(id: string): Promise<CrewPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewModel.findById(id);
  return doc ? toCrew(doc) : null;
}

export async function findCrewByEmail(email: string): Promise<CrewPublic | null> {
  const doc = await CrewModel.findOne({ email: email.toLowerCase() });
  return doc ? toCrew(doc) : null;
}

export async function findCrewByEmailWithPassword(email: string): Promise<(CrewPublic & { password: string }) | null> {
  const doc = await CrewModel.findOne({ email: email.toLowerCase() }).select("+password");
  if (!doc) return null;
  return { ...toCrew(doc), password: doc.password };
}

export async function findAllCrew(): Promise<CrewPublic[]> {
  const docs = await CrewModel.find().sort({ createdAt: -1 });
  return docs.map((doc) => toCrew(doc));
}

export async function createCrew(data: Omit<Crew, "id">): Promise<CrewPublic> {
  const doc = await CrewModel.create(data);
  return toCrew(doc);
}
