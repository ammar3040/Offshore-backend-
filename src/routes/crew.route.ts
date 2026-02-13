import { Router } from "express";
import { getCrew, loginCrew, postCrew } from "../controllers";
import { authenticateAdmin, authenticateCrew } from "../middleware/auth";
import { crewUpload } from "../middleware/upload";
import { uploadCrewFilesToCloudinary } from "../middleware/cloudinaryUpload";

const router = Router();

// crew management
router.get("/", authenticateAdmin, getCrew);
router.post("/login", loginCrew);

// create crew
router.post("/", crewUpload, uploadCrewFilesToCloudinary, postCrew);

export default router;
