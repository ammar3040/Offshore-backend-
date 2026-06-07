import { Router } from "express";
import adminRoutes from "./admin.routes";
import airportsRoutes from "./airports.routes";
import authRoutes from "./auth.routes";
import superadminRoutes from "./superadmin.routes";
import crewAvailabilityRoutes from "./crewAvailability.routes";
import contractRoutes from "./contract.routes";
import crewInviteRoutes from "./crewInvite.routes";
import crewTicketRoutes from "./crewTicket.routes";
import crewRoutes from "./crew.route";
import payrollRoutes from "./payroll.routes";
import projectRoutes from "./project.routes";
import rigRoutes from "./rig.routes";
import timesheetRoutes from "./timesheet.routes";

const router = Router();

// Example route
router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.use("/admin", adminRoutes);
router.use("/airports", airportsRoutes);
router.use("/auth", authRoutes);
router.use("/superadmin", superadminRoutes);
router.use("/crew", crewRoutes);
router.use("/crew-availability", crewAvailabilityRoutes);
router.use("/contracts", contractRoutes);
router.use("/crew-invite", crewInviteRoutes);
router.use("/crew-ticket", crewTicketRoutes);
router.use("/payroll", payrollRoutes);
router.use("/project", projectRoutes);
router.use("/rig", rigRoutes);
router.use("/timesheet", timesheetRoutes);

export default router;

