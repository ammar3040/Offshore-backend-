import mongoose, { Schema, Document, Model } from "mongoose";
import { CrewStatus } from "./crew.model";

export interface CrewAvailability {
  id: string;
  crew_id: mongoose.Types.ObjectId;
  from: Date;
  to: Date;
  isAvailable?: boolean;
  employer?: string;
  client?: string;
  rig_vessel?: string;
  country?: string;
  notes?: string;
  status?: string;
  /** When set, this range was created from a crew ticket booking (removed on cancel). */
  ticket_id?: mongoose.Types.ObjectId;
  /** When set, this range represents an 'In Project' block linked to a project. */
  project_id?: mongoose.Types.ObjectId;
}

export interface CrewAvailabilityDocument extends Omit<CrewAvailability, "id">, Document {
  _id: mongoose.Types.ObjectId;
  isAvailable?: boolean;
  status?: string;
}

const crewAvailabilitySchema = new Schema<CrewAvailabilityDocument>(
  {
    crew_id: { type: Schema.Types.ObjectId, ref: "Crew", required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    isAvailable: { type: Boolean, default: true },
    employer: { type: String, required: false },
    client: { type: String, required: false },
    rig_vessel: { type: String, required: false },
    country: { type: String, required: false },
    notes: { type: String, required: false },
    status: { type: String, enum: Object.values(CrewStatus), required: false },
    ticket_id: { type: Schema.Types.ObjectId, ref: "CrewTicket", required: false, index: true },
    project_id: { type: Schema.Types.ObjectId, ref: "Project", required: false, index: true },
  },
  { timestamps: true }
);

export const CrewAvailabilityModel: Model<CrewAvailabilityDocument> =
  mongoose.models.CrewAvailability ??
  mongoose.model<CrewAvailabilityDocument>("CrewAvailability", crewAvailabilitySchema);

export function toCrewAvailability(doc: CrewAvailabilityDocument): CrewAvailability {
  return {
    id: doc._id.toString(),
    crew_id: doc.crew_id,
    from: doc.from,
    to: doc.to,
    isAvailable: doc.isAvailable !== false,
    employer: doc.employer,
    client: doc.client,
    rig_vessel: doc.rig_vessel,
    country: doc.country,
    notes: doc.notes,
    status: doc.status,
    ticket_id: doc.ticket_id,
    project_id: doc.project_id,
  };
}

export async function findCrewAvailabilityById(id: string): Promise<CrewAvailability | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewAvailabilityModel.findById(id).populate("crew_id");
  return doc ? toCrewAvailability(doc) : null;
}

export async function findCrewAvailabilitiesByCrewId(
  crewId: string
): Promise<CrewAvailability[]> {
  if (!mongoose.Types.ObjectId.isValid(crewId)) return [];
  const docs = await CrewAvailabilityModel.find({
    crew_id: new mongoose.Types.ObjectId(crewId),
  })
    .sort({ from: 1 })
    .populate("crew_id");
  return docs.map((doc) => toCrewAvailability(doc));
}

export async function createCrewAvailability(
  data: Omit<CrewAvailability, "id">
): Promise<CrewAvailability> {
  const doc = await CrewAvailabilityModel.create(data);
  return toCrewAvailability(doc);
}

export async function updateCrewAvailability(
  id: string,
  data: Partial<Omit<CrewAvailability, "id" | "crew_id">>
): Promise<CrewAvailability | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewAvailabilityModel.findByIdAndUpdate(id, data, { new: true }).populate(
    "crew_id"
  );
  return doc ? toCrewAvailability(doc) : null;
}

export async function deleteCrewAvailability(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const result = await CrewAvailabilityModel.findByIdAndDelete(id);
  return !!result;
}

/** Find distinct crew_ids whose availability (isAvailable=true) overlaps with the given date range */
export async function findCrewIdsWithAvailabilityOverlappingRange(
  startDate: Date,
  endDate: Date
): Promise<mongoose.Types.ObjectId[]> {
  const docs = await CrewAvailabilityModel.find({
    from: { $lte: endDate },
    to: { $gte: startDate },
    isAvailable: { $ne: false },
  }).distinct("crew_id");
  return docs;
}

/** Find availability by id and ensure it belongs to the given crew */
export async function findCrewAvailabilityByIdAndCrewId(
  id: string,
  crewId: string
): Promise<CrewAvailability | null> {
  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(crewId)) {
    return null;
  }
  const doc = await CrewAvailabilityModel.findOne({
    _id: new mongoose.Types.ObjectId(id),
    crew_id: new mongoose.Types.ObjectId(crewId),
  }).populate("crew_id");
  return doc ? toCrewAvailability(doc) : null;
}
