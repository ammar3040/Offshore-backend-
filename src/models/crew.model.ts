import mongoose, { Schema, Document, Model } from "mongoose";

export enum IdentityType {
  NationalId = "national_id",
  DrivingLicense = "driving_license",
  IdentityNumber = "identity_number",
}

export interface Passport {
  passport_number?: string;
  issue_date?: string;
  expiry_date: string;
  issuing_country?: string;
  passport_document: string;
}

export interface Identity {
  identity_type?: IdentityType;
  identity_number?: string;
  issue_date?: string;
  expiry_date?: string;
  identity_document?: string;
}

export interface CrewCertificate {
  certificate_name: string;
  issue_date: string;
  expiry_date: string;
  certificate_document: string;
}

export interface Crew {
  id: string;
  /** Admin who registered this crew member. */
  createdBy?: mongoose.Types.ObjectId;
  firstname: string;
  lastname: string;
  dateOfBirth?: string;
  nationality?: string;
  gender: string;
  email: string;
  phone: string;
  alternate_phone?: string;
  address?: string;
  city?: string;
  country?: string;
  postal_code?: string;
  password: string; // hashed
  passport: Passport;
  identity?: Identity;
  crew_certificate: CrewCertificate[];
  azerbaijan_vantage_number?: string;
  norwegian_d_number?: string;
  dawinci_number?: string;
  vantage_number?: string;
  organization?: string;
  linkedin?: string;
  visa?: string;
  rank?: string;
}

// Mongoose document type (has _id)
export interface CrewDocument extends Omit<Crew, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

const passportSchema = new Schema<Passport>(
  {
    passport_number: { type: String },
    issue_date: { type: String },
    expiry_date: { type: String, required: true },
    issuing_country: { type: String },
    passport_document: { type: String, required: true },
  },
  { _id: false }
);

const identitySchema = new Schema<Identity>(
  {
    identity_type: { type: String, enum: Object.values(IdentityType) },
    identity_number: { type: String },
    issue_date: { type: String },
    expiry_date: { type: String },
    identity_document: { type: String },
  },
  { _id: false }
);

const crewCertificateSchema = new Schema<CrewCertificate>(
  {
    certificate_name: { type: String, required: true },
    issue_date: { type: String, required: true },
    expiry_date: { type: String, required: true },
    certificate_document: { type: String, required: true },
  },
  { _id: false }
);

const crewSchema = new Schema<CrewDocument>(
  {
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin", required: false },
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    dateOfBirth: { type: String },
    nationality: { type: String },
    gender: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    alternate_phone: { type: String },
    address: { type: String },
    city: { type: String },
    country: { type: String },
    postal_code: { type: String },
    password: { type: String, required: true, select: false },
    passport: { type: passportSchema, required: true },
    identity: { type: identitySchema, required: false },
    crew_certificate: { type: [crewCertificateSchema], default: [] },
    azerbaijan_vantage_number: { type: String },
    norwegian_d_number: { type: String },
    dawinci_number: { type: String },
    vantage_number: { type: String },
    organization: { type: String },
    linkedin: { type: String },
    visa: { type: String },
    rank: { type: String },
  },
  { timestamps: true }
);

const CrewModel: Model<CrewDocument> =
  mongoose.models.Crew ?? mongoose.model<CrewDocument>("Crew", crewSchema);

/** Crew without password - safe for API responses */
export type CrewPublic = Omit<Crew, "password">;

function normalizeCrewCertificates(
  raw: CrewDocument["crew_certificate"]
): CrewCertificate[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  // Backward compat: old format was single object without certificate_name
  const old = raw as unknown as { issue_date?: string; expiry_date?: string; certificate_document?: string };
  if (old?.issue_date != null && old?.expiry_date != null && old?.certificate_document != null) {
    return [{
      certificate_name: "Certificate",
      issue_date: old.issue_date,
      expiry_date: old.expiry_date,
      certificate_document: old.certificate_document,
    }];
  }
  return [];
}

function toCrew(doc: CrewDocument): CrewPublic {
  return {
    id: doc._id.toString(),
    createdBy: doc.createdBy as mongoose.Types.ObjectId | undefined,
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
    crew_certificate: normalizeCrewCertificates(doc.crew_certificate),
    azerbaijan_vantage_number: doc.azerbaijan_vantage_number,
    norwegian_d_number: doc.norwegian_d_number,
    dawinci_number: doc.dawinci_number,
    vantage_number: doc.vantage_number,
    organization: doc.organization,
    linkedin: doc.linkedin,
    visa: doc.visa,
    rank: doc.rank,
  };
}

export async function findCrewById(id: string): Promise<CrewPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewModel.findById(id);
  return doc ? toCrew(doc) : null;
}

/** Find crew by crew_id (the reference from CrewTicket). Queries by _id since crew_id stores Crew's _id. */
export async function findCrewByCrewId(crewId: string): Promise<CrewPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(crewId)) return null;
  const doc = await CrewModel.findOne({ _id: new mongoose.Types.ObjectId(crewId) });
  return doc ? toCrew(doc) : null;
}

export async function findCrewByIds(ids: mongoose.Types.ObjectId[]): Promise<CrewPublic[]> {
  if (ids.length === 0) return [];
  const docs = await CrewModel.find({ _id: { $in: ids } });
  return docs.map((doc) => toCrew(doc));
}

export async function findCrewByIdWithPassword(
  id: string
): Promise<(CrewPublic & { password: string }) | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewModel.findById(id).select("+password");
  if (!doc) return null;
  return { ...toCrew(doc), password: doc.password };
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

export async function findAllCrew(filter?: {
  createdBy?: string | mongoose.Types.ObjectId;
}): Promise<CrewPublic[]> {
  const query = filter?.createdBy ? { createdBy: filter.createdBy } : {};
  const docs = await CrewModel.find(query).sort({ createdAt: -1 });
  return docs.map((doc) => toCrew(doc));
}

/** Raw document for ownership checks (`createdBy` is always ObjectId when set). */
export async function findCrewDocumentById(id: string): Promise<CrewDocument | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return CrewModel.findById(id);
}

export async function createCrew(data: Omit<Crew, "id">): Promise<CrewPublic> {
  const doc = await CrewModel.create(data);
  return toCrew(doc);
}

export async function updateCrewPassword(id: string, hashedPassword: string): Promise<CrewPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewModel.findByIdAndUpdate(id, { password: hashedPassword }, { new: true });
  return doc ? toCrew(doc) : null;
}

/** Partial update of crew fields (excludes password). */
export async function updateCrew(
  id: string,
  data: Partial<Omit<Crew, "id" | "password">>
): Promise<CrewPublic | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const update = { ...data } as Record<string, unknown>;
  delete update.password;
  delete update.id;
  if (Object.keys(update).length === 0) return findCrewById(id);
  const doc = await CrewModel.findByIdAndUpdate(id, { $set: update }, { new: true });
  return doc ? toCrew(doc) : null;
}

export async function deleteCrew(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const result = await CrewModel.findByIdAndDelete(id);
  return !!result;
}

export async function countCrew(): Promise<number> {
  return CrewModel.countDocuments();
}
