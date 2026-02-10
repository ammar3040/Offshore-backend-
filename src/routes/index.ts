import { Router } from "express";
import adminRoutes from "./admin.routes";
import crewRoutes from "./crew.route";

const router = Router();

// Example route
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/admin", adminRoutes);
router.use("/crew", crewRoutes);

export default router;

