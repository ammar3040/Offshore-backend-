import mongoose, { Schema, Document, Model } from "mongoose";

export interface AirportLocation {
  Name: string;
  COUNTRY: string;
  COUNTRYNAME: string;
}

export interface FlightTicket {
  id: string;
  tripType: string;
  from: AirportLocation;
  to: AirportLocation;
  departureDate: string;
  adults: number;
  children: number;
  infants: number;
  cabinClass: string;
  stops: string[];
  preferredAirlines: string[];
  currency: string;
  fareTypes: string[];
}
// deployment fix 1

export interface FlightTicketDocument extends Omit<FlightTicket, "id">, Document {
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

const flightTicketSchema = new Schema<FlightTicketDocument>(
  {
    tripType: { type: String, required: true },
    from: { type: airportLocationSchema, required: true },
    to: { type: airportLocationSchema, required: true },
    departureDate: { type: String, required: true },
    adults: { type: Number, required: true },
    children: { type: Number, required: true, default: 0 },
    infants: { type: Number, required: true, default: 0 },
    cabinClass: { type: String, required: true },
    stops: { type: [String], default: [] },
    preferredAirlines: { type: [String], default: [] },
    currency: { type: String, required: true },
    fareTypes: { type: [String], default: [] },
  },
  { timestamps: true }
);

const FlightTicketModel: Model<FlightTicketDocument> =
  mongoose.models.FlightTicket ?? mongoose.model<FlightTicketDocument>("FlightTicket", flightTicketSchema);

function toFlightTicket(doc: FlightTicketDocument): FlightTicket {
  return {
    id: doc._id.toString(),
    tripType: doc.tripType,
    from: doc.from,
    to: doc.to,
    departureDate: doc.departureDate,
    adults: doc.adults,
    children: doc.children,
    infants: doc.infants,
    cabinClass: doc.cabinClass,
    stops: doc.stops ?? [],
    preferredAirlines: doc.preferredAirlines ?? [],
    currency: doc.currency,
    fareTypes: doc.fareTypes ?? [],
  };
}

export async function findFlightTicketById(id: string): Promise<FlightTicket | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await FlightTicketModel.findById(id);
  return doc ? toFlightTicket(doc) : null;
}

export async function findAllFlightTickets(): Promise<FlightTicket[]> {
  const docs = await FlightTicketModel.find().sort({ createdAt: -1 });
  return docs.map((doc) => toFlightTicket(doc));
}

export async function createFlightTicket(data: Omit<FlightTicket, "id">): Promise<FlightTicket> {
  const doc = await FlightTicketModel.create(data);
  return toFlightTicket(doc);
}
