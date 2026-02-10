import mongoose from "mongoose";

// const DEFAULT_URI = "mongodb://127.0.0.1:27017/marine-flight-backend";

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI environment variable is not set.");
  }

  try {
    await mongoose.connect(uri);
    // eslint-disable-next-line no-console
    console.log("Connected to MongoDB:", uri);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

