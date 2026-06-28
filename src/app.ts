import "dotenv/config";
import cors, { CorsOptions } from "cors";
import express, { Request, Response } from "express";
import routes from "./routes";
import { connectDB } from "./dbconnection";
import { encryptionMiddleware } from "./middleware/encryption";

const app = express();

const allowedOrigins = [
  "https://off-shore-frontend.vercel.app",
  "http://localhost:5173",
  "https://subseacore.com",
  "https://www.subseacore.com",
  ...(process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
];

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    const normalizedOrigin = origin?.replace(/\/$/, "");
    if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-auth-token", "x-token", "X-Token"],
  exposedHeaders: ["Content-Disposition", "Content-Length", "Content-Type"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

app.use(express.json());
app.use(encryptionMiddleware);

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
