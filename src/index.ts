import "dotenv/config";
import cors from "cors";
import express, { Request, Response } from "express";
import routes from "./routes";
import { connectDB } from "./dbconnection";
import { startTimesheetWorker } from "./jobs/timesheetWorker";

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  "https://off-shore-frontend.vercel.app",
  "http://localhost:5173",
  ...(process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/", (req: Request, res: Response) => {
  res.json({ message: "Hello from Express + TypeScript!" });
});

app.use("/api", routes);

async function startServer() {
  await connectDB();
  startTimesheetWorker();

  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});