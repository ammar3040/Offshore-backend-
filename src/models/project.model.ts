import mongoose, { Schema, Document, Model } from "mongoose";

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
  createdBy: string; // admin_id reference
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
    createdBy: { type: String, required: true }, // admin_id reference
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
    createdBy: doc.createdBy,
    participants: doc.participants,
  };
}

export async function findProjectById(id: string): Promise<Project | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await ProjectModel.findById(id).populate("participants");
  return doc ? toProject(doc) : null;
}

export async function findAllProjects(): Promise<Project[]> {
  const docs = await ProjectModel.find().sort({ createdAt: -1 }).populate("participants");
  return docs.map((doc) => toProject(doc));
}

export async function createProject(
  data: Omit<Project, "id" | "status" | "participants"> & { status?: ProjectStatus; participants?: mongoose.Types.ObjectId[] }
): Promise<Project> {
  const doc = await ProjectModel.create(data);
  return toProject(doc);
}

export async function updateProject(
  id: string,
  data: Partial<Omit<Project, "id">>
): Promise<Project | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await ProjectModel.findByIdAndUpdate(id, data, { new: true }).populate("participants");
  return doc ? toProject(doc) : null;
}

export async function deleteProject(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const result = await ProjectModel.findByIdAndDelete(id);
  return !!result;
}
