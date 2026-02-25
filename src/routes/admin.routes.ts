import { Router } from "express";
import { loginAdmin } from "../controllers";

const router = Router();

router.post("/login", loginAdmin);

export default router;

