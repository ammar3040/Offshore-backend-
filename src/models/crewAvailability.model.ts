import mongoose, { Schema, Document, Model } from "mongoose";

export interface CrewAvailability {
  id: string;
  crew_id: mongoose.Types.ObjectId;
  from: Date;
  to: Date;
}

export interface CrewAvailabilityDocument extends Omit<CrewAvailability, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

const crewAvailabilitySchema = new Schema<CrewAvailabilityDocument>(
  {
    crew_id: { type: Schema.Types.ObjectId, ref: "Crew", required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
  },
  { timestamps: true }
);

const CrewAvailabilityModel: Model<CrewAvailabilityDocument> =
  mongoose.models.CrewAvailability ??
  mongoose.model<CrewAvailabilityDocument>("CrewAvailability", crewAvailabilitySchema);

function toCrewAvailability(doc: CrewAvailabilityDocument): CrewAvailability {
  return {
    id: doc._id.toString(),
    crew_id: doc.crew_id,
    from: doc.from,
    to: doc.to,
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
  data: Partial<Pick<CrewAvailability, "from" | "to">>
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

/** Find distinct crew_ids whose availability overlaps with the given date range */
export async function findCrewIdsWithAvailabilityOverlappingRange(
  startDate: Date,
  endDate: Date
): Promise<mongoose.Types.ObjectId[]> {
  const docs = await CrewAvailabilityModel.find({
    from: { $lte: endDate },
    to: { $gte: startDate },
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
