import mongoose, { Schema, Document, Model } from "mongoose";
import type { AdminPublic } from "./admin.model";

function isPopulatedAdmin(
  val: unknown
): val is { _id: mongoose.Types.ObjectId; firstname: string; lastname: string; email: string; phone: string; balance: number } {
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
}): AdminPublic {
  return {
    id: doc._id.toString(),
    firstname: doc.firstname,
    lastname: doc.lastname,
    email: doc.email,
    phone: doc.phone,
    balance: doc.balance ?? 0,
  };
}

export enum ProjectStatus {
  Active = "active",
  OnHold = "onhold",
  Finished = "finished",
}

export interface ProjectDuration {
  startDate: Date;
  endDate: Date;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  duration: ProjectDuration;
  span: string;
  status: ProjectStatus;
  createdBy: mongoose.Types.ObjectId | AdminPublic; // Admin reference (ObjectId when unpopulated, admin object when populated)
  participants: mongoose.Types.ObjectId[]; // crew_ids references
}

export interface ProjectDocument extends Omit<Project, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

const projectDurationSchema = new Schema<ProjectDuration>(
  {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { _id: false }
);

const projectSchema = new Schema<ProjectDocument>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    duration: { type: projectDurationSchema, required: true },
    span: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(ProjectStatus),
      default: ProjectStatus.Active,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
    participants: { type: [{ type: Schema.Types.ObjectId, ref: "Crew" }], default: [] },
  },
  { timestamps: true }
);

const ProjectModel: Model<ProjectDocument> =
  mongoose.models.Project ?? mongoose.model<ProjectDocument>("Project", projectSchema);

function toProject(doc: ProjectDocument): Project {
  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description,
    duration: doc.duration,
    span: doc.span,
    status: (doc.status as ProjectStatus) ?? ProjectStatus.Active,
    createdBy: isPopulatedAdmin(doc.createdBy)
      ? toAdminPublic(doc.createdBy)
      : (doc.createdBy as mongoose.Types.ObjectId),
    participants: doc.participants,
  };
}

export async function findProjectById(id: string): Promise<Project | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await ProjectModel.findById(id)
    .populate("participants")
    .populate("createdBy");
  return doc ? toProject(doc) : null;
}

export async function findAllProjects(filter?: { createdBy?: string | mongoose.Types.ObjectId }): Promise<Project[]> {
  const query = filter?.createdBy ? { createdBy: filter.createdBy } : {};
  const docs = await ProjectModel.find(query)
    .sort({ createdAt: -1 })
    .populate("participants")
    .populate("createdBy");
  return docs.map((doc) => toProject(doc));
}

export async function createProject(
  data: Omit<Project, "id" | "status" | "participants"> & { status?: ProjectStatus; participants?: mongoose.Types.ObjectId[] }
): Promise<Project> {
  const doc = await ProjectModel.create(data);
  const populated = await ProjectModel.findById(doc._id)
    .populate("participants")
    .populate("createdBy");
  return toProject(populated ?? doc);
}

export async function updateProject(
  id: string,
  data: Partial<Omit<Project, "id">>
): Promise<Project | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await ProjectModel.findByIdAndUpdate(id, data, { new: true })
    .populate("participants")
    .populate("createdBy");
  return doc ? toProject(doc) : null;
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const result = await ProjectModel.findByIdAndDelete(id);
  return !!result;
}

export async function countProjects(): Promise<number> {
  return ProjectModel.countDocuments();
}

/** Count distinct admins who have created at least one project (active admins) */
export async function countActiveAdmins(): Promise<number> {
  const adminIds = await ProjectModel.distinct("createdBy");
  return adminIds.length;
}
