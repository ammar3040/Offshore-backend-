import "dotenv/config";
import express, { Request, Response } from "express";
import routes from "./routes";
import { connectDB } from "./dbconnection";
import { startTimesheetWorker } from "./jobs/timesheetWorker";

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = [
  "https://off-shore-frontend.vercel.app",
  "http://localhost:5173",
];

// ✅ Robust CORS middleware (handles preflight + headers)
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!origin || allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // ✅ Handle preflight request
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

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