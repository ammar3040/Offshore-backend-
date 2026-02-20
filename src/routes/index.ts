import { Router } from "express";
import adminRoutes from "./admin.routes";
import crewAvailabilityRoutes from "./crewAvailability.routes";
import crewInviteRoutes from "./crewInvite.routes";
import crewRoutes from "./crew.route";
import projectRoutes from "./project.routes";
import timesheetRoutes from "./timesheet.routes";

const router = Router();

// Example route
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/admin", adminRoutes);
router.use("/crew", crewRoutes);
router.use("/crew-availability", crewAvailabilityRoutes);
router.use("/crew-invite", crewInviteRoutes);
router.use("/project", projectRoutes);
router.use("/timesheet", timesheetRoutes);

export default router;

