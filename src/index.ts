import "dotenv/config";
import app from "./app";
import { connectDB } from "./dbconnection";
import { startTimesheetWorker } from "./jobs/timesheetWorker";

const PORT = process.env.PORT || 3000;

async function startServer() {
  await connectDB();
  startTimesheetWorker();

  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

export default app;
