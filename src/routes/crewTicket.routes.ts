import { Router } from "express";
import {
  deleteCrewTicketHandler,
  getCrewTicketById,
  getCrewTickets,
  patchCrewTicket,
  postCrewTicket,
} from "../controllers";
import { authenticateAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  createCrewTicketSchema,
  crewTicketIdParamSchema,
  updateCrewTicketSchema,
} from "../validations/crewTicket.validation";

const router = Router();

router.get("/", authenticateAdmin, getCrewTickets);
router.get("/:id", authenticateAdmin, validate(crewTicketIdParamSchema, "params"), getCrewTicketById);
router.post("/", authenticateAdmin, validate(createCrewTicketSchema), postCrewTicket);
router.patch(
  "/:id",
  authenticateAdmin,
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
