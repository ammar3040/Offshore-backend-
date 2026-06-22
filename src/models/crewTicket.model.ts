import mongoose, { Schema, Document, Model } from "mongoose";
import type { AirportLocation } from "./flightTicket.model";
import { ProjectModel } from "./project.model";

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

export enum CrewTicketStatus {
  Unapproved = "UNAPPROVED",
  Approved = "APPROVED",
}

export interface StoredFlightItinerarySegment {
  airlineName?: string;
  airlineCode?: string;
  flightNumber?: string;
  from?: string;
  to?: string;
  fromAirport?: string;
  toAirport?: string;
  departureTime?: string;
  arrivalTime?: string;
  cabin?: string;
  baggage?: string;
  cabinBaggage?: string;
}

export interface StoredFlightLeg {
  from?: string;
  to?: string;
  departureTime?: string;
  arrivalTime?: string;
  duration?: string;
  airlineName?: string;
  airlineCode?: string;
  itinerary?: StoredFlightItinerarySegment[];
}

export interface StoredFlightFare {
  totalFare?: number;
  cabin?: string;
  name?: string;
}

/** Full flight details from search/book — used for crew ticket emails. */
export interface CrewTicketFlightSnapshot {
  airlineName?: string;
  airlineCode?: string;
  legs: StoredFlightLeg[];
  fares?: StoredFlightFare[];
  /** Display currency for fare in emails (e.g. INR from search). */
  currency?: string;
}

export interface CrewTicket {
  id: string;
  crew_id?: mongoose.Types.ObjectId;
  project_id?: mongoose.Types.ObjectId;
  /** Admin who booked the ticket when no project is assigned. */
  createdBy?: mongoose.Types.ObjectId;
  /** Oil rig assignment (optional). */
  rig_id?: mongoose.Types.ObjectId;
  from: AirportLocation;
  to: AirportLocation;
  class: CabinClass;
  adult: number;
  children: number;
  infants: number;
  trip: TripType;
  /** Optional URL to uploaded ticket PDF */
  pdf?: string;
  /** Approval status for the ticket lifecycle */
  status: CrewTicketStatus;
  /** Booking reference added by superadmin during approval */
  bookingReference?: string;
  /** Approval audit metadata */
  approvedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
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
  /** Search/book flight payload for ticket emails */
  flightSnapshot?: CrewTicketFlightSnapshot;
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

const flightItinerarySegmentSchema = new Schema<StoredFlightItinerarySegment>(
  {
    airlineName: { type: String, required: false },
    airlineCode: { type: String, required: false },
    flightNumber: { type: String, required: false },
    from: { type: String, required: false },
    to: { type: String, required: false },
    fromAirport: { type: String, required: false },
    toAirport: { type: String, required: false },
    departureTime: { type: String, required: false },
    arrivalTime: { type: String, required: false },
    cabin: { type: String, required: false },
    baggage: { type: String, required: false },
    cabinBaggage: { type: String, required: false },
  },
  { _id: false }
);

const flightLegSchema = new Schema<StoredFlightLeg>(
  {
    from: { type: String, required: false },
    to: { type: String, required: false },
    departureTime: { type: String, required: false },
    arrivalTime: { type: String, required: false },
    duration: { type: String, required: false },
    airlineName: { type: String, required: false },
    airlineCode: { type: String, required: false },
    itinerary: { type: [flightItinerarySegmentSchema], default: [] },
  },
  { _id: false }
);

const flightFareSchema = new Schema<StoredFlightFare>(
  {
    totalFare: { type: Number, required: false },
    cabin: { type: String, required: false },
    name: { type: String, required: false },
  },
  { _id: false }
);

const flightSnapshotSchema = new Schema<CrewTicketFlightSnapshot>(
  {
    airlineName: { type: String, required: false },
    airlineCode: { type: String, required: false },
    legs: { type: [flightLegSchema], default: [] },
    fares: { type: [flightFareSchema], default: [] },
    currency: { type: String, required: false },
  },
  { _id: false }
);

const crewTicketSchema = new Schema<CrewTicketDocument>(
  {
    crew_id: { type: Schema.Types.ObjectId, ref: "Crew", required: false },
    project_id: { type: Schema.Types.ObjectId, ref: "Project", required: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin", required: false },
    rig_id: { type: Schema.Types.ObjectId, ref: "Rig", required: false },
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
    status: {
      type: String,
      enum: Object.values(CrewTicketStatus),
      required: true,
      default: CrewTicketStatus.Unapproved,
    },
    bookingReference: { type: String, required: false, trim: true },
    approvedAt: { type: Date, required: false },
    approvedBy: { type: Schema.Types.ObjectId, ref: "SuperAdmin", required: false },
    markup: { type: Number, required: true, default: 0 },
    balance: { type: Number, required: true, default: 0 },
    price: { type: Number, required: true, default: 0 },
    cashback: { type: Number, required: true, default: 0 },
    travelStart: { type: Date, required: false },
    travelEnd: { type: Date, required: false },
    flightSnapshot: { type: flightSnapshotSchema, required: false },
  },
  { timestamps: true }
);

crewTicketSchema.index({ project_id: 1, crew_id: 1 });
crewTicketSchema.index({ rig_id: 1 });

const CrewTicketModel: Model<CrewTicketDocument> =
  mongoose.models.CrewTicket ?? mongoose.model<CrewTicketDocument>("CrewTicket", crewTicketSchema);

function toCrewTicket(doc: CrewTicketDocument): CrewTicket {
  return {
    id: doc._id.toString(),
    crew_id: doc.crew_id,
    project_id: doc.project_id,
    createdBy: doc.createdBy,
    rig_id: doc.rig_id,
    from: doc.from,
    to: doc.to,
    class: doc.class as CabinClass,
    adult: doc.adult,
    children: doc.children,
    infants: doc.infants,
    trip: doc.trip as TripType,
    pdf: doc.pdf,
    status: (doc.status as CrewTicketStatus) ?? CrewTicketStatus.Unapproved,
    bookingReference: doc.bookingReference,
    approvedAt: doc.approvedAt,
    approvedBy: doc.approvedBy,
    markup: doc.markup ?? 0,
    balance: doc.balance ?? 0,
    price: doc.price ?? 0,
    cashback: doc.cashback ?? 0,
    travelStart: doc.travelStart,
    travelEnd: doc.travelEnd,
    flightSnapshot: doc.flightSnapshot,
  };
}

export async function findCrewTicketById(id: string): Promise<CrewTicket | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewTicketModel.findById(id)
    .populate("crew_id")
    .populate("project_id")
    .populate("rig_id");
  return doc ? toCrewTicket(doc) : null;
}

export async function findCrewTicketsByCrewId(crewId: string): Promise<CrewTicket[]> {
  if (!mongoose.Types.ObjectId.isValid(crewId)) return [];
  const docs = await CrewTicketModel.find({ crew_id: crewId })
    .sort({ createdAt: -1 })
    .populate("crew_id")
    .populate("project_id")
    .populate("rig_id");
  return docs.map((doc) => toCrewTicket(doc));
}

export interface CrewTicketListOptions {
  page?: number;
  limit?: number;
  status?: CrewTicketStatus;
}

export interface ListPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedCrewTicketList {
  tickets: CrewTicket[];
  pagination?: ListPagination;
}

async function buildAdminCrewTicketAccessFilter(
  adminId: string
): Promise<Record<string, unknown> | null> {
  if (!mongoose.Types.ObjectId.isValid(adminId)) return null;
  const adminObjectId = new mongoose.Types.ObjectId(adminId);
  const projectDocs = await ProjectModel.find({ createdBy: adminObjectId }).select("_id");
  const projectIds = projectDocs.map((p) => p._id);
  return projectIds.length > 0
    ? {
        $or: [
          { project_id: { $in: projectIds } },
          {
            createdBy: adminObjectId,
            $or: [{ project_id: null }, { project_id: { $exists: false } }],
          },
        ],
      }
    : {
        createdBy: adminObjectId,
        $or: [{ project_id: null }, { project_id: { $exists: false } }],
      };
}

async function queryCrewTickets(
  filter: Record<string, unknown>,
  options?: CrewTicketListOptions
): Promise<PaginatedCrewTicketList> {
  const fullFilter = options?.status ? { ...filter, status: options.status } : filter;
  const baseQuery = CrewTicketModel.find(fullFilter)
    .sort({ createdAt: -1 })
    .populate("crew_id")
    .populate("project_id")
    .populate("rig_id");

  if (!options?.limit) {
    const docs = await baseQuery;
    return { tickets: docs.map((doc) => toCrewTicket(doc)) };
  }

  const page = options.page ?? 1;
  const limit = options.limit;
  const total = await CrewTicketModel.countDocuments(fullFilter);
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const docs = await baseQuery.skip((page - 1) * limit).limit(limit);
  return {
    tickets: docs.map((doc) => toCrewTicket(doc)),
    pagination: { page, limit, total, totalPages },
  };
}

export async function findAllCrewTicketsPaginated(
  options?: CrewTicketListOptions
): Promise<PaginatedCrewTicketList> {
  return queryCrewTickets({}, options);
}

export async function findCrewTicketsByAdminIdPaginated(
  adminId: string,
  options?: CrewTicketListOptions
): Promise<PaginatedCrewTicketList> {
  const accessFilter = await buildAdminCrewTicketAccessFilter(adminId);
  if (!accessFilter) return { tickets: [] };
  return queryCrewTickets(accessFilter, options);
}

export async function findAllCrewTickets(): Promise<CrewTicket[]> {
  const docs = await CrewTicketModel.find()
    .sort({ createdAt: -1 })
    .populate("crew_id")
    .populate("project_id")
    .populate("rig_id");
  return docs.map((doc) => toCrewTicket(doc));
}

export async function findCrewTicketsByAdminId(adminId: string): Promise<CrewTicket[]> {
  const accessFilter = await buildAdminCrewTicketAccessFilter(adminId);
  if (!accessFilter) return [];
  const docs = await CrewTicketModel.find(accessFilter)
    .sort({ createdAt: -1 })
    .populate("crew_id")
    .populate("project_id")
    .populate("rig_id");
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

/** Find an existing ticket with the same crew, project, and travel window (optional duplicate detection). */
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

export async function createCrewTicket(
  data: Omit<CrewTicket, "id" | "status" | "bookingReference" | "approvedAt" | "approvedBy"> &
    Partial<Pick<CrewTicket, "status" | "bookingReference" | "approvedAt" | "approvedBy">>
): Promise<CrewTicket> {
  const doc = await CrewTicketModel.create(data);
  const populated = await CrewTicketModel.findById(doc._id)
    .populate("crew_id")
    .populate("project_id")
    .populate("rig_id");
  return toCrewTicket(populated ?? doc);
}

export async function updateCrewTicket(
  id: string,
  data: Partial<Omit<CrewTicket, "id" | "crew_id" | "project_id">>
): Promise<CrewTicket | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await CrewTicketModel.findByIdAndUpdate(id, data, { new: true })
    .populate("crew_id")
    .populate("project_id")
    .populate("rig_id");
  return doc ? toCrewTicket(doc) : null;
}

/** Persist the Cloudinary public delivery URL on the crew ticket. */
export async function updateCrewTicketPdfUrl(id: string, pdfUrl: string): Promise<CrewTicket | null> {
  const trimmed = pdfUrl.trim();
  if (!trimmed) {
    throw new Error("PDF URL is required.");
  }
  return updateCrewTicket(id, { pdf: trimmed });
}

export async function deleteCrewTicket(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const result = await CrewTicketModel.findByIdAndDelete(id);
  return !!result;
}

export async function countCrewTickets(): Promise<number> {
  return CrewTicketModel.countDocuments();
}

/** Crew tickets grouped by the admin who owns the ticket's project (`project.createdBy`). */
export async function aggregateTicketCountsByAdmin(): Promise<Map<string, number>> {
  const rows = await CrewTicketModel.aggregate<{ _id: mongoose.Types.ObjectId; c: number }>([
    {
      $lookup: {
        from: ProjectModel.collection.name,
        localField: "project_id",
        foreignField: "_id",
        as: "proj",
      },
    },
    { $unwind: "$proj" },
    { $group: { _id: "$proj.createdBy", c: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.c]));
}

export async function sumMarkupByProject(projectId: string): Promise<number> {
  const result = await CrewTicketModel.aggregate([
    { $match: { project_id: new mongoose.Types.ObjectId(projectId) } },
    { $group: { _id: null, total: { $sum: "$markup" } } },
  ]);
  return result[0]?.total ?? 0;
}

export interface CrewTicketReportSpendsRow {
  price: number;
  class: string;
  to: { COUNTRYNAME?: string; COUNTRY?: string };
  createdAt: Date;
}

export async function buildCrewTicketReportSpendsScopeFilter(options: {
  userId: string;
  isSuperAdmin: boolean;
  projectId?: string;
}): Promise<Record<string, unknown> | null> {
  const { userId, isSuperAdmin, projectId } = options;

  if (projectId) {
    if (!mongoose.Types.ObjectId.isValid(projectId)) return null;
    const projectFilter = { project_id: new mongoose.Types.ObjectId(projectId) };
    if (isSuperAdmin) return projectFilter;
    const accessFilter = await buildAdminCrewTicketAccessFilter(userId);
    if (!accessFilter) return null;
    return { $and: [accessFilter, projectFilter] };
  }

  if (isSuperAdmin) return {};
  return buildAdminCrewTicketAccessFilter(userId);
}

export async function findCrewTicketRowsForReportSpends(
  filter: Record<string, unknown>
): Promise<CrewTicketReportSpendsRow[]> {
  const docs = await CrewTicketModel.find(filter)
    .select("price class to createdAt")
    .sort({ createdAt: -1 })
    .lean<Array<CrewTicketReportSpendsRow & { _id: unknown }>>();
  return docs.map((doc) => ({
    price: doc.price,
    class: doc.class,
    to: doc.to,
    createdAt: doc.createdAt,
  }));
}

/** Sum of `price` (GBP) across this project's APPROVED crew tickets — the invoice ticket subtotal. */
export async function sumApprovedTicketPriceByProject(projectId: string): Promise<number> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) return 0;
  const result = await CrewTicketModel.aggregate([
    {
      $match: {
        project_id: new mongoose.Types.ObjectId(projectId),
        status: CrewTicketStatus.Approved,
      },
    },
    { $group: { _id: null, total: { $sum: "$price" } } },
  ]);
  return result[0]?.total ?? 0;
}
