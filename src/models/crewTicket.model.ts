import mongoose, { Schema, Document, Model } from "mongoose";
import type { AirportLocation } from "./flightTicket.model";

export enum CabinClass {
  Economy = "ECONOMY",
  PremiumEconomy = "PREMIUM_ECONOMY",
  Business = "BUSINESS",
  FirstClass = "FIRST_CLASS",
}

export enum TripType {
  OneWay = "ONE_WAY",
  RoundTrip = "ROUND_TRIP",
}

export interface CrewTicket {
  id: string;
  crew_id: mongoose.Types.ObjectId;
  project_id: mongoose.Types.ObjectId;
  from: AirportLocation;
  to: AirportLocation;
  class: CabinClass;
  adult: number;
  children: number;
  infants: number;
  trip: TripType;
  /** Optional URL to uploaded ticket PDF */
  pdf?: string;
  /** Markup applied to this booking */
  markup: number;
  /** Running balance — cumulative markup across bookings for the project */
  balance: number;
  /** Price of the ticket */
  price: number;
  /** Cashback for this booking */
  cashback: number;
  /** First leg departure (from search/book payload) — used to detect duplicate bookings */
  travelStart?: Date;
  /** Last leg arrival — used with travelStart for duplicate detection */
  travelEnd?: Date;
}

export interface CrewTicketDocument extends Omit<CrewTicket, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

const airportLocationSchema = new Schema<AirportLocation>(
  {
    Name: { type: String, required: true },
    COUNTRY: { type: String, required: true },
    COUNTRYNAME: { type: String, required: true },
  },
  { _id: false }
);

const crewTicketSchema = new Schema<CrewTicketDocument>(
  {
    crew_id: { type: Schema.Types.ObjectId, ref: "Crew", required: true },
    project_id: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    from: { type: airportLocationSchema, required: true },
    to: { type: airportLocationSchema, required: true },
    class: {
      type: String,
      enum: Object.values(CabinClass),
      required: true,
    },
    adult: { type: Number, required: true },
    children: { type: Number, required: true, default: 0 },
    infants: { type: Number, required: true, default: 0 },
    trip: {
      type: String,
      enum: Object.values(TripType),
      required: true,
    },
    pdf: { type: String, required: false },
    markup: { type: Number, required: true, default: 0 },
    balance: { type: Number, required: true, default: 0 },
    price: { type: Number, required: true, default: 0 },
    cashback: { type: Number, required: true, default: 0 },
    travelStart: { type: Date, required: false },
    travelEnd: { type: Date, required: false },
  },
  { timestamps: true }
);

crewTicketSchema.index({ project_id: 1, crew_id: 1 });

const CrewTicketModel: Model<CrewTicketDocument> =
  mongoose.models.CrewTicket ?? mongoose.model<CrewTicketDocument>("CrewTicket", crewTicketSchema);

function toCrewTicket(doc: CrewTicketDocument): CrewTicket {
  return {
    id: doc._id.toString(),
    crew_id: doc.crew_id,
    project_id: doc.project_id,
    from: doc.from,
    to: doc.to,
    class: doc.class as CabinClass,
    adult: doc.adult,
    children: doc.children,
    infants: doc.infants,
    trip: doc.trip as TripType,
    pdf: doc.pdf,
    markup: doc.markup ?? 0,
    balance: doc.balance ?? 0,
    price: doc.price ?? 0,
    cashback: doc.cashback ?? 0,
    travelStart: doc.travelStart,
    travelEnd: doc.travelEnd,
  };
}

export async function findCrewTicketById(id: string): Promise<CrewTicket | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewTicketModel.findById(id)
    .populate("crew_id")
    .populate("project_id");
  return doc ? toCrewTicket(doc) : null;
}

export async function findCrewTicketsByCrewId(crewId: string): Promise<CrewTicket[]> {
  if (!mongoose.Types.ObjectId.isValid(crewId)) return [];
  const docs = await CrewTicketModel.find({ crew_id: crewId })
    .sort({ createdAt: -1 })
    .populate("crew_id")
    .populate("project_id");
  return docs.map((doc) => toCrewTicket(doc));
}

export async function findAllCrewTickets(): Promise<CrewTicket[]> {
  const docs = await CrewTicketModel.find()
    .sort({ createdAt: -1 })
    .populate("crew_id")
    .populate("project_id");
  return docs.map((doc) => toCrewTicket(doc));
}

export async function findCrewTicketByProjectAndCrew(
  projectId: string,
  crewId: string
): Promise<CrewTicket | null> {
  if (!mongoose.Types.ObjectId.isValid(projectId) || !mongoose.Types.ObjectId.isValid(crewId)) {
    return null;
  }
  const doc = await CrewTicketModel.findOne({ project_id: projectId, crew_id: crewId });
  return doc ? toCrewTicket(doc) : null;
}

/**
 * Conflict if an existing ticket for this crew+project blocks a hypothetical booking —
 * legacy row without travel bounds blocks any re-book; otherwise same travel window (start+end) blocks.
 * (POST /book uses {@link findCrewTicketByProjectAndCrew}: any ticket for the project+crew is a conflict.)
 */
export async function findCrewTicketBookConflict(
  projectId: string,
  crewId: string,
  travelStart: Date | null,
  travelEnd: Date | null
): Promise<CrewTicket | null> {
  if (!mongoose.Types.ObjectId.isValid(projectId) || !mongoose.Types.ObjectId.isValid(crewId)) {
    return null;
  }
  const docs = await CrewTicketModel.find({ project_id: projectId, crew_id: crewId });
  for (const doc of docs) {
    const exStart = doc.travelStart;
    const exEnd = doc.travelEnd;
    if (!travelStart || !travelEnd) {
      return toCrewTicket(doc);
    }
    if (exStart == null || exEnd == null) {
      return toCrewTicket(doc);
    }
    if (exStart.getTime() === travelStart.getTime() && exEnd.getTime() === travelEnd.getTime()) {
      return toCrewTicket(doc);
    }
  }
  return null;
}

/** Drops legacy unique index on project_id+crew_id if present so multiple trips per crew are allowed. */
export async function ensureCrewTicketIndexes(): Promise<void> {
  try {
    await CrewTicketModel.collection.dropIndex("project_id_1_crew_id_1");
  } catch {
    // Index missing or already non-unique
  }
  await CrewTicketModel.syncIndexes();
}

export async function createCrewTicket(data: Omit<CrewTicket, "id">): Promise<CrewTicket> {
  const doc = await CrewTicketModel.create(data);
  const populated = await CrewTicketModel.findById(doc._id)
    .populate("crew_id")
    .populate("project_id");
  return toCrewTicket(populated ?? doc);
}

export async function updateCrewTicket(
  id: string,
  data: Partial<Omit<CrewTicket, "id" | "crew_id" | "project_id">>
): Promise<CrewTicket | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewTicketModel.findByIdAndUpdate(id, data, { new: true })
    .populate("crew_id")
    .populate("project_id");
  return doc ? toCrewTicket(doc) : null;
}

export async function deleteCrewTicket(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const result = await CrewTicketModel.findByIdAndDelete(id);
  return !!result;
}

export async function countCrewTickets(): Promise<number> {
  return CrewTicketModel.countDocuments();
}

export async function sumMarkupByProject(projectId: string): Promise<number> {
  const result = await CrewTicketModel.aggregate([
    { $match: { project_id: new mongoose.Types.ObjectId(projectId) } },
    { $group: { _id: null, total: { $sum: "$markup" } } },
  ]);
  return result[0]?.total ?? 0;
}
