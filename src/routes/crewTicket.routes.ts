import { Router } from "express";
import {
  bookFlight,
  deleteCrewTicketHandler,
  getCrewTicketById,
  getCrewTickets,
  getCrewTicketsByCrewId,
  patchCrewTicket,
  postCrewTicket,
  searchFlights,
  searchFlightsController,
  sendTicketToCrewEmail,
  uploadTicketPdf,
} from "../controllers";
import { authenticateAdmin, authenticateAdminOrCrew, authenticateAdminOrSuperAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { crewTicketPdfUpload } from "../middleware/upload";
import { uploadCrewTicketPdfToCloudinary } from "../middleware/cloudinaryUpload";
import {
  bookFlightSchema,
  createCrewTicketSchema,
  crewIdParamSchema,
  crewTicketIdParamSchema,
  searchFlightsSchema,
  updateCrewTicketSchema,
} from "../validations/crewTicket.validation";

const router = Router();

router.get("/", authenticateAdminOrSuperAdmin, getCrewTickets);
router.get("/crew/:id", authenticateAdminOrCrew, validate(crewIdParamSchema, "params"), getCrewTicketsByCrewId);
router.get("/:id", authenticateAdminOrCrew, validate(crewTicketIdParamSchema, "params"), getCrewTicketById);
router.post("/", authenticateAdmin, validate(createCrewTicketSchema), postCrewTicket);
router.post("/search-flights", authenticateAdmin, validate(searchFlightsSchema), searchFlightsController);
router.post("/book", authenticateAdmin, validate(bookFlightSchema), bookFlight);
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
router.delete(
  "/:id",
  authenticateAdmin,
  validate(crewTicketIdParamSchema, "params"),
  deleteCrewTicketHandler
);

export default router;
