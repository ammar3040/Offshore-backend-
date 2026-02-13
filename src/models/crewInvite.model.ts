import mongoose, { Schema, Document, Model } from "mongoose";

export enum AcceptanceStatus {
  Pending = "pending",
  Rejected = "rejected",
  Accepted = "accepted",
}

export interface CrewInvite {
  id: string;
  crew_id: mongoose.Types.ObjectId;
  project_id: mongoose.Types.ObjectId;
  acceptanceStatus: AcceptanceStatus;
}

export interface CrewInviteDocument extends Omit<CrewInvite, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

const crewInviteSchema = new Schema<CrewInviteDocument>(
  {
    crew_id: { type: Schema.Types.ObjectId, ref: "Crew", required: true },
    project_id: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    acceptanceStatus: {
      type: String,
      enum: Object.values(AcceptanceStatus),
      default: AcceptanceStatus.Pending,
    },
  },
  { timestamps: true }
);

const CrewInviteModel: Model<CrewInviteDocument> =
  mongoose.models.CrewInvite ?? mongoose.model<CrewInviteDocument>("CrewInvite", crewInviteSchema);

function toCrewInvite(doc: CrewInviteDocument): CrewInvite {
  return {
    id: doc._id.toString(),
    crew_id: doc.crew_id,
    project_id: doc.project_id,
    acceptanceStatus: (doc.acceptanceStatus as AcceptanceStatus) ?? AcceptanceStatus.Pending,
  };
}

export async function findCrewInviteById(id: string): Promise<CrewInvite | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewInviteModel.findById(id).populate("crew_id project_id");
  return doc ? toCrewInvite(doc) : null;
}

export async function findAllCrewInvites(): Promise<CrewInvite[]> {
  const docs = await CrewInviteModel.find().sort({ createdAt: -1 }).populate("crew_id project_id");
  return docs.map((doc) => toCrewInvite(doc));
}

export async function createCrewInvite(
  data: Omit<CrewInvite, "id" | "acceptanceStatus"> & { acceptanceStatus?: AcceptanceStatus }
): Promise<CrewInvite> {
  const doc = await CrewInviteModel.create(data);
  return toCrewInvite(doc);
}

export async function acceptCrewInvite(
  crewId: string,
  projectId: string
): Promise<CrewInvite | null> {
  if (!mongoose.Types.ObjectId.isValid(crewId) || !mongoose.Types.ObjectId.isValid(projectId)) {
    return null;
  }
  const doc = await CrewInviteModel.findOneAndUpdate(
    { crew_id: new mongoose.Types.ObjectId(crewId), project_id: new mongoose.Types.ObjectId(projectId) },
    { acceptanceStatus: AcceptanceStatus.Accepted },
    { new: true }
  ).populate("crew_id project_id");
  return doc ? toCrewInvite(doc) : null;
}
