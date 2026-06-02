import mongoose, { Schema, Document, Model } from "mongoose";

export enum PayrollRateType {
  PerHour = "per_hour",
  PerProject = "per_project",
}

export interface Payroll {
  id: string;
  crew_id: mongoose.Types.ObjectId;
  project_id: mongoose.Types.ObjectId;
  rate_type: PayrollRateType;
  pay_amount: number;
  createdBy: mongoose.Types.ObjectId;
}

export interface PayrollDocument extends Omit<Payroll, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

const payrollSchema = new Schema<PayrollDocument>(
  {
    crew_id: { type: Schema.Types.ObjectId, ref: "Crew", required: true },
    project_id: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    rate_type: {
      type: String,
      enum: Object.values(PayrollRateType),
      required: true,
    },
    pay_amount: { type: Number, required: true, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
  },
  { timestamps: true }
);

payrollSchema.index({ crew_id: 1, project_id: 1 }, { unique: true });

const PayrollModel: Model<PayrollDocument> =
  mongoose.models.Payroll ?? mongoose.model<PayrollDocument>("Payroll", payrollSchema);

function toPayroll(doc: PayrollDocument): Payroll {
  return {
    id: doc._id.toString(),
    crew_id: doc.crew_id as mongoose.Types.ObjectId,
    project_id: doc.project_id as mongoose.Types.ObjectId,
    rate_type: doc.rate_type,
    pay_amount: doc.pay_amount,
    createdBy: doc.createdBy as mongoose.Types.ObjectId,
  };
}

export async function findPayrollById(id: string): Promise<Payroll | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await PayrollModel.findById(id).populate("crew_id project_id");
  return doc ? toPayroll(doc) : null;
}

export async function findPayrollByCrewAndProject(
  crewId: string | mongoose.Types.ObjectId,
  projectId: string | mongoose.Types.ObjectId
): Promise<Payroll | null> {
  if (!mongoose.Types.ObjectId.isValid(crewId) || !mongoose.Types.ObjectId.isValid(projectId)) {
    return null;
  }
  const doc = await PayrollModel.findOne({
    crew_id: new mongoose.Types.ObjectId(crewId),
    project_id: new mongoose.Types.ObjectId(projectId),
  }).populate("crew_id project_id");
  return doc ? toPayroll(doc) : null;
}

export async function findAllPayrolls(filter?: {
  createdBy?: string | mongoose.Types.ObjectId;
}): Promise<Payroll[]> {
  const query = filter?.createdBy ? { createdBy: filter.createdBy } : {};
  const docs = await PayrollModel.find(query)
    .sort({ updatedAt: -1 })
    .populate("crew_id project_id");
  return docs.map((doc) => toPayroll(doc));
}

export async function upsertPayroll(data: {
  crew_id: mongoose.Types.ObjectId;
  project_id: mongoose.Types.ObjectId;
  rate_type: PayrollRateType;
  pay_amount: number;
  createdBy: mongoose.Types.ObjectId;
}): Promise<Payroll> {
  const doc = await PayrollModel.findOneAndUpdate(
    { crew_id: data.crew_id, project_id: data.project_id },
    {
      crew_id: data.crew_id,
      project_id: data.project_id,
      rate_type: data.rate_type,
      pay_amount: data.pay_amount,
      createdBy: data.createdBy,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).populate("crew_id project_id");

  if (!doc) {
    throw new Error("Failed to upsert payroll record.");
  }
  return toPayroll(doc);
}

export async function deletePayroll(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const result = await PayrollModel.findByIdAndDelete(id);
  return !!result;
}
