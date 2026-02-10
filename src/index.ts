import "dotenv/config";
import cors from "cors";
import express, { Request, Response } from "express";
import routes from "./routes";
import { connectDB } from "./dbconnection";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req: Request, res: Response) => {
  res.json({ message: "Hello from Express + TypeScript!" });
});

app.use("/api", routes);

async function startServer() {
  await connectDB();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", err);
});

