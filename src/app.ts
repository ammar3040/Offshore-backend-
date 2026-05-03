import "dotenv/config";
import cors from "cors";
import express, { Request, Response } from "express";
import routes from "./routes";
import { connectDB } from "./dbconnection";

const app = express();

const allowedOrigins = [
  "https://off-shore-frontend.vercel.app",
  "http://localhost:5173",
  "https://subseacore.com",
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

app.use(async (req, _res, next) => {
  if (req.method === "OPTIONS") {
    next();
    return;
  }
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Hello from Express + TypeScript!" });
});

app.use("/", routes);

app.use(
  (
    err: unknown,
    _req: Request,
    res: Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(503).json({ message: "Service temporarily unavailable" });
  }
);

export default app;
