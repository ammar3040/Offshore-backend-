import { Router } from "express";
import {
  approveCrewTicket,
  bookFlight,
  deleteCrewTicketHandler,
  downloadCrewTicketPdf,
  getCrewTicketById,
  getCrewTickets,
  getCrewTicketReportSpends,
  getCrewTicketsByCrewId,
  patchCrewTicket,
  postCrewTicket,
  searchAirports,
  searchFlights,
  searchFlightsController,
  sendTicketToCrewEmail,
  uploadTicketPdf,
} from "../controllers";
import { authenticateAdmin, authenticateAdminOrCrew, authenticateAdminOrSuperAdmin, authenticateSuperAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { crewTicketPdfUpload } from "../middleware/upload";
import { uploadCrewTicketPdfToCloudinary } from "../middleware/cloudinaryUpload";
import {
  approveCrewTicketSchema,
  bookFlightSchema,
  createCrewTicketSchema,
  crewIdParamSchema,
  crewTicketIdParamSchema,
  listCrewTicketsQuerySchema,
  reportSpendsQuerySchema,
  searchFlightsSchema,
  updateCrewTicketSchema,
} from "../validations/crewTicket.validation";

const router = Router();

router.get("/", authenticateAdminOrSuperAdmin, validate(listCrewTicketsQuerySchema, "query"), getCrewTickets);
router.get(
  "/spends",
  authenticateAdminOrSuperAdmin,
  validate(reportSpendsQuerySchema, "query"),
  getCrewTicketReportSpends
);
router.get("/airports/search", searchAirports);
router.get("/crew/:id", authenticateAdminOrCrew, validate(crewIdParamSchema, "params"), getCrewTicketsByCrewId);
router.get("/:id/pdf", authenticateAdminOrCrew, validate(crewTicketIdParamSchema, "params"), downloadCrewTicketPdf);
router.get("/:id", authenticateAdminOrCrew, validate(crewTicketIdParamSchema, "params"), getCrewTicketById);
router.post("/", authenticateAdmin, validate(createCrewTicketSchema), postCrewTicket);
router.post("/search-flights", authenticateAdmin, validate(searchFlightsSchema), searchFlightsController);
router.post("/book", authenticateAdmin, validate(bookFlightSchema), bookFlight);
router.patch(
  "/:id/approve",
  authenticateSuperAdmin,
  validate(crewTicketIdParamSchema, "params"),
  validate(approveCrewTicketSchema),
  approveCrewTicket
);
router.post(
  "/:id/send-ticket-email",
  authenticateAdminOrSuperAdmin,
  validate(crewTicketIdParamSchema, "params"),
  sendTicketToCrewEmail
);
router.post(
  "/:id/upload-ticket",
  authenticateAdminOrSuperAdmin,
  validate(crewTicketIdParamSchema, "params"),
  crewTicketPdfUpload,
  uploadCrewTicketPdfToCloudinary,
  uploadTicketPdf
);
router.patch(
  "/:id",
  authenticateAdminOrSuperAdmin,
  validate(crewTicketIdParamSchema, "params"),
  validate(updateCrewTicketSchema),
  patchCrewTicket
);
/** Admin panel: cancel ticket (same behavior as DELETE /:id — accrues cancellation debt, then removes ticket). */
router.post(
  "/:id/cancel",
  authenticateAdmin,
  validate(crewTicketIdParamSchema, "params"),
  deleteCrewTicketHandler
);
router.delete(
  "/:id",
  authenticateAdmin,
  validate(crewTicketIdParamSchema, "params"),
  deleteCrewTicketHandler
);

export default router;
