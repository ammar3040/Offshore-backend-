import mongoose from "mongoose";
import { ensureAdminInvoiceIndexes } from "./models/adminInvoice.model";
import { ensureCrewTicketIndexes } from "./models/crewTicket.model";

// const DEFAULT_URI = "mongodb://127.0.0.1:27017/marine-flight-backend";

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI environment variable is not set.");
  }

  if (mongoose.connection.readyState === 1) {
    return;
  }

  try {
    await mongoose.connect(uri);
    // eslint-disable-next-line no-console
    console.log("Connected to MongoDB");
    await ensureCrewTicketIndexes();
    await ensureAdminInvoiceIndexes();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to connect to MongoDB:", error);
    throw error;
  }
}

