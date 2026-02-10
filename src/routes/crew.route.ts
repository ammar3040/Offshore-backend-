import { Router } from "express";
import { postCrew } from "../controllers";
import { crewUpload } from "../middleware/upload";

const router = Router();

router.post("/", crewUpload, postCrew);

export default router;
