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
  contract_body?: string;
  contract_title?: string;
  contract_signed_at?: Date;
  contract_end_date?: Date;
}

export interface SignedContractSummary {
  id: string;
  crew_id: string;
  crew_name: string;
  project_id: string;
  project_title: string;
  contract_end_date: Date;
  signed_at: Date;
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
    contract_body: { type: String },
    contract_title: { type: String },
    contract_signed_at: { type: Date },
    contract_end_date: { type: Date },
  },
  { timestamps: true }
);

crewInviteSchema.index({ crew_id: 1, project_id: 1 }, { unique: true });

const CrewInviteModel: Model<CrewInviteDocument> =
  mongoose.models.CrewInvite ?? mongoose.model<CrewInviteDocument>("CrewInvite", crewInviteSchema);

function toCrewInvite(doc: CrewInviteDocument): CrewInvite {
  return {
    id: doc._id.toString(),
    crew_id: doc.crew_id,
    project_id: doc.project_id,
    acceptanceStatus: (doc.acceptanceStatus as AcceptanceStatus) ?? AcceptanceStatus.Pending,
    ...(doc.contract_body != null && { contract_body: doc.contract_body }),
    ...(doc.contract_title != null && { contract_title: doc.contract_title }),
    ...(doc.contract_signed_at != null && { contract_signed_at: doc.contract_signed_at }),
    ...(doc.contract_end_date != null && { contract_end_date: doc.contract_end_date }),
  };
}

function resolvePopulatedName(
  ref: mongoose.Types.ObjectId | { firstname?: string; lastname?: string; title?: string; _id?: mongoose.Types.ObjectId },
  nameFields: "crew" | "project"
): { id: string; name: string } {
  if (ref instanceof mongoose.Types.ObjectId) {
    return { id: ref.toString(), name: "" };
  }
  const id = ref._id?.toString() ?? "";
  if (nameFields === "crew") {
    const crew = ref as { firstname?: string; lastname?: string };
    return { id, name: [crew.firstname, crew.lastname].filter(Boolean).join(" ").trim() };
  }
  const project = ref as { title?: string };
  return { id, name: project.title ?? "" };
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

export async function findExistingInviteCrewIdsForProject(
  projectId: mongoose.Types.ObjectId,
  crewIds: mongoose.Types.ObjectId[]
): Promise<Set<string>> {
  if (crewIds.length === 0) return new Set();
  const docs = await CrewInviteModel.find({
    project_id: projectId,
    crew_id: { $in: crewIds },
  }).select("crew_id");
  return new Set(docs.map((d) => d.crew_id.toString()));
}

export async function createCrewInvite(
  data: Omit<CrewInvite, "id" | "acceptanceStatus"> & { acceptanceStatus?: AcceptanceStatus }
): Promise<CrewInvite> {
  const doc = await CrewInviteModel.create(data);
  return toCrewInvite(doc);
}

export async function findPendingInvitesByCrewId(crewId: string): Promise<CrewInvite[]> {
  if (!mongoose.Types.ObjectId.isValid(crewId)) return [];
  const docs = await CrewInviteModel.find({
    crew_id: new mongoose.Types.ObjectId(crewId),
    acceptanceStatus: AcceptanceStatus.Pending,
  })
    .sort({ createdAt: -1 })
    .populate("crew_id project_id");
  return docs.map((doc) => toCrewInvite(doc));
}

export async function findAcceptedInvitesByCrewId(crewId: string): Promise<CrewInvite[]> {
  if (!mongoose.Types.ObjectId.isValid(crewId)) return [];
  const docs = await CrewInviteModel.find({
    crew_id: new mongoose.Types.ObjectId(crewId),
    acceptanceStatus: AcceptanceStatus.Accepted,
  })
    .sort({ createdAt: -1 })
    .populate("crew_id project_id");
  return docs.map((doc) => toCrewInvite(doc));
}

/**
 * Find crew IDs who have accepted invites to projects whose duration overlaps with the given range.
 * These crews are considered "assigned" and not available for other projects in that period.
 */
export async function findCrewIdsWithAcceptedInvitesOverlappingRange(
  startDate: Date,
  endDate: Date
): Promise<mongoose.Types.ObjectId[]> {
  const ProjectModel = mongoose.model("Project");
  const docs = await CrewInviteModel.aggregate([
    { $match: { acceptanceStatus: AcceptanceStatus.Accepted } },
    {
      $lookup: {
        from: ProjectModel.collection.name,
        localField: "project_id",
        foreignField: "_id",
        as: "project",
      },
    },
    { $unwind: "$project" },
    {
      $match: {
        "project.duration.startDate": { $lte: endDate },
        "project.duration.endDate": { $gte: startDate },
      },
    },
    { $project: { crew_id: 1 } },
    { $group: { _id: "$crew_id" } },
  ]);
  return docs.map((d) => d._id as mongoose.Types.ObjectId);
}

export async function updatePendingInviteContractFields(
  projectId: mongoose.Types.ObjectId,
  crewIds: mongoose.Types.ObjectId[],
  fields: { contract_body?: string; contract_title?: string }
): Promise<CrewInvite[]> {
  if (crewIds.length === 0) return [];
  const update: { contract_body?: string; contract_title?: string } = {};
  if (fields.contract_body != null) update.contract_body = fields.contract_body;
  if (fields.contract_title != null) update.contract_title = fields.contract_title;
  if (Object.keys(update).length === 0) return [];

  await CrewInviteModel.updateMany(
    {
      project_id: projectId,
      crew_id: { $in: crewIds },
      acceptanceStatus: AcceptanceStatus.Pending,
    },
    { $set: update }
  );

  const docs = await CrewInviteModel.find({
    project_id: projectId,
    crew_id: { $in: crewIds },
    acceptanceStatus: AcceptanceStatus.Pending,
  })
    .sort({ createdAt: -1 })
    .populate("crew_id project_id");
  return docs.map((doc) => toCrewInvite(doc));
}

export async function acceptCrewInvite(
  crewId: string,
  projectId: string,
  options?: { contract_end_date?: Date }
): Promise<CrewInvite | null> {
  if (!mongoose.Types.ObjectId.isValid(crewId) || !mongoose.Types.ObjectId.isValid(projectId)) {
    return null;
  }
  const update: {
    acceptanceStatus: AcceptanceStatus;
    contract_signed_at: Date;
    contract_end_date?: Date;
  } = {
    acceptanceStatus: AcceptanceStatus.Accepted,
    contract_signed_at: new Date(),
  };
  if (options?.contract_end_date) {
    update.contract_end_date = options.contract_end_date;
  }

  const doc = await CrewInviteModel.findOneAndUpdate(
    {
      crew_id: new mongoose.Types.ObjectId(crewId),
      project_id: new mongoose.Types.ObjectId(projectId),
      acceptanceStatus: AcceptanceStatus.Pending,
    },
    update,
    { new: true }
  ).populate("crew_id project_id");
  return doc ? toCrewInvite(doc) : null;
}

export async function findSignedContracts(
  filter?: { projectIds?: mongoose.Types.ObjectId[] }
): Promise<SignedContractSummary[]> {
  const query: Record<string, unknown> = {
    acceptanceStatus: AcceptanceStatus.Accepted,
    contract_signed_at: { $ne: null },
  };
  if (filter?.projectIds?.length) {
    query.project_id = { $in: filter.projectIds };
  }

  const docs = await CrewInviteModel.find(query)
    .sort({ contract_signed_at: -1 })
    .populate("crew_id project_id");

  return docs
    .filter((doc) => doc.contract_signed_at != null && doc.contract_end_date != null)
    .map((doc) => {
      const crew = resolvePopulatedName(doc.crew_id, "crew");
      const project = resolvePopulatedName(doc.project_id, "project");
      return {
        id: doc._id.toString(),
        crew_id: crew.id,
        crew_name: crew.name,
        project_id: project.id,
        project_title: project.name,
        contract_end_date: doc.contract_end_date as Date,
        signed_at: doc.contract_signed_at as Date,
      };
    });
}

/** Reject/unassign crew from project. Used when removing crew from assigned project. */
export async function rejectCrewInvite(
  crewId: string,
  projectId: string
): Promise<CrewInvite | null> {
  if (!mongoose.Types.ObjectId.isValid(crewId) || !mongoose.Types.ObjectId.isValid(projectId)) {
    return null;
  }
  const doc = await CrewInviteModel.findOneAndUpdate(
    { crew_id: new mongoose.Types.ObjectId(crewId), project_id: new mongoose.Types.ObjectId(projectId) },
    { acceptanceStatus: AcceptanceStatus.Rejected },
    { new: true }
  ).populate("crew_id project_id");
  return doc ? toCrewInvite(doc) : null;
}
