import mongoose, { Schema, Document, Model } from "mongoose";

export enum AttendanceStatus {
  Present = "PRESENT",
  Leave = "LEAVE",
  Absent = "ABSENT",
}

export interface TimesheetEntry {
  date: Date;
  status: AttendanceStatus;
}

export interface Timesheet {
  id: string;
  crew_id: mongoose.Types.ObjectId;
  project_id: mongoose.Types.ObjectId;
  entries: TimesheetEntry[];
}

export interface TimesheetDocument extends Omit<Timesheet, "id">, Document {
  _id: mongoose.Types.ObjectId;
}

const timesheetEntrySchema = new Schema<TimesheetEntry>(
  {
    date: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(AttendanceStatus),
      default: AttendanceStatus.Present,
    },
  },
  { _id: false }
);

const timesheetSchema = new Schema<TimesheetDocument>(
  {
    crew_id: { type: Schema.Types.ObjectId, ref: "Crew", required: true },
    project_id: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    entries: { type: [timesheetEntrySchema], default: [] },
  },
  { timestamps: true }
);

timesheetSchema.index({ crew_id: 1, project_id: 1 }, { unique: true });

const TimesheetModel: Model<TimesheetDocument> =
  mongoose.models.Timesheet ?? mongoose.model<TimesheetDocument>("Timesheet", timesheetSchema);

function toTimesheet(doc: TimesheetDocument): Timesheet {
  return {
    id: doc._id.toString(),
    crew_id: doc.crew_id as mongoose.Types.ObjectId,
    project_id: doc.project_id as mongoose.Types.ObjectId,
    entries: doc.entries,
  };
}

export async function findTimesheetById(id: string): Promise<Timesheet | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await TimesheetModel.findById(id).populate("crew_id project_id");
  return doc ? toTimesheet(doc) : null;
}

export async function findTimesheetByCrewAndProject(
  crewId: string | mongoose.Types.ObjectId,
  projectId: string | mongoose.Types.ObjectId
): Promise<Timesheet | null> {
  if (!mongoose.Types.ObjectId.isValid(crewId) || !mongoose.Types.ObjectId.isValid(projectId)) {
    return null;
  }
  const doc = await TimesheetModel.findOne({
    crew_id: new mongoose.Types.ObjectId(crewId),
    project_id: new mongoose.Types.ObjectId(projectId),
  })
    .populate("crew_id project_id");
  return doc ? toTimesheet(doc) : null;
}

export async function findTimesheetsByProject(
  projectId: string | mongoose.Types.ObjectId
): Promise<Timesheet[]> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) return [];
  const docs = await TimesheetModel.find({
    project_id: new mongoose.Types.ObjectId(projectId),
  })
    .sort({ createdAt: -1 })
    .populate("crew_id project_id");
  return docs.map((doc) => toTimesheet(doc));
}

export async function findTimesheetsByCrew(
  crewId: string | mongoose.Types.ObjectId
): Promise<Timesheet[]> {
  if (!mongoose.Types.ObjectId.isValid(crewId)) return [];
  const docs = await TimesheetModel.find({
    crew_id: new mongoose.Types.ObjectId(crewId),
  })
    .sort({ createdAt: -1 })
    .populate("crew_id project_id");
  return docs.map((doc) => toTimesheet(doc));
}

/**
 * Create a timesheet for a crew member on a project.
 * Entries are empty; the daily worker marks PRESENT for each day as it occurs.
 * Idempotent: returns existing timesheet if one already exists.
 */
export async function deleteTimesheetByCrewAndProject(
  crewId: string | mongoose.Types.ObjectId,
  projectId: string | mongoose.Types.ObjectId
): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(crewId) || !mongoose.Types.ObjectId.isValid(projectId)) {
    return false;
  }
  const result = await TimesheetModel.deleteOne({
    crew_id: new mongoose.Types.ObjectId(crewId),
    project_id: new mongoose.Types.ObjectId(projectId),
  });
  return (result.deletedCount ?? 0) > 0;
}

export async function createTimesheetForCrewProject(
  crewId: mongoose.Types.ObjectId,
  projectId: mongoose.Types.ObjectId,
  _startDate: Date,
  _endDate: Date
): Promise<Timesheet> {
  const existing = await TimesheetModel.findOne({
    crew_id: crewId,
    project_id: projectId,
  });
  if (existing) {
    return toTimesheet(existing);
  }

  const doc = await TimesheetModel.create({
    crew_id: crewId,
    project_id: projectId,
    entries: [],
  });

  const populated = await TimesheetModel.findById(doc._id).populate("crew_id project_id");
  return toTimesheet(populated ?? doc);
}

export async function updateTimesheetEntryStatus(
  timesheetId: string,
  date: string | Date,
  status: AttendanceStatus
): Promise<Timesheet | null> {
  const targetDate = typeof date === "string" ? new Date(date) : new Date(date);
  return upsertTimesheetEntry(timesheetId, targetDate, status);
}

export async function updateTimesheetEntryStatusByCrewAndProject(
  crewId: string | mongoose.Types.ObjectId,
  projectId: string | mongoose.Types.ObjectId,
  date: string | Date,
  status: AttendanceStatus,
  projectStartDate: Date,
  projectEndDate: Date
): Promise<Timesheet | null> {
  const timesheet = await findTimesheetByCrewAndProject(crewId, projectId);
  if (!timesheet) return null;

  const targetDate = typeof date === "string" ? new Date(date) : new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);
  const start = new Date(projectStartDate);
  const end = new Date(projectEndDate);
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  if (targetDate < start || targetDate > end) {
    return null;
  }

  return upsertTimesheetEntry(timesheet.id, targetDate, status);
}

/** Add or update an entry for a date. Used by crew and worker. */
async function upsertTimesheetEntry(
  timesheetId: string,
  targetDate: Date,
  status: AttendanceStatus
): Promise<Timesheet | null> {
  if (!mongoose.Types.ObjectId.isValid(timesheetId)) return null;
  targetDate.setUTCHours(0, 0, 0, 0);

  const doc = await TimesheetModel.findOne({ _id: new mongoose.Types.ObjectId(timesheetId) });
  if (!doc) return null;

  const entryIndex = doc.entries.findIndex((e) => {
    const d = new Date(e.date);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() === targetDate.getTime();
  });

  if (entryIndex >= 0) {
    doc.entries[entryIndex].status = status;
  } else {
    doc.entries.push({ date: targetDate, status });
    doc.entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }
  await doc.save();

  const populated = await TimesheetModel.findById(doc._id).populate("crew_id project_id");
  return populated ? toTimesheet(populated) : null;
}

/**
 * Mark today as PRESENT for all timesheets whose project spans today.
 * Run daily via cron.
 */
export async function markTodayPresentForAllTimesheets(): Promise<{ updated: number }> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const ProjectModel = mongoose.model("Project");
  const projectDocs = await ProjectModel.find({
    "duration.startDate": { $lte: today },
    "duration.endDate": { $gte: today },
  }).select("_id");

  const projectIds = projectDocs.map((p: { _id: mongoose.Types.ObjectId }) => p._id);
  if (projectIds.length === 0) return { updated: 0 };

  const timesheetDocs = await TimesheetModel.find({ project_id: { $in: projectIds } });
  let updated = 0;

  for (const doc of timesheetDocs) {
    const hasToday = doc.entries.some((e) => {
      const d = new Date(e.date);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime() === today.getTime();
    });
    if (!hasToday) {
      doc.entries.push({ date: new Date(today), status: AttendanceStatus.Present });
      doc.entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      await doc.save();
      updated++;
    }
  }

  return { updated };
}
