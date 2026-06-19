import { Router } from "express";
import { deletePayrollHandler, getPayrolls, postPayroll } from "../controllers/payroll.controller";
import { authenticateAdmin, authenticateAdminOrSuperAdmin } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { payrollIdParamSchema, upsertPayrollSchema } from "../validations/payroll.validation";

const router = Router();

router.get("/", authenticateAdminOrSuperAdmin, getPayrolls);
router.post("/", authenticateAdmin, validate(upsertPayrollSchema), postPayroll);
router.delete(
  "/:id",
  authenticateAdmin,
  validate(payrollIdParamSchema, "params"),
  deletePayrollHandler
);

export default router;
