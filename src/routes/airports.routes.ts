import { Router } from "express";
import { searchAirports } from "../controllers";

const router = Router();

router.get("/search", searchAirports);

export default router;
