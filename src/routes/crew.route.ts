import { Router } from "express";
import { getCrew, getCrewMe, loginCrew, postCrew } from "../controllers";
import { authenticateAdmin, authenticateCrew } from "../middleware/auth";
import { crewUpload } from "../middleware/upload";
import { uploadCrewFilesToCloudinary } from "../middleware/cloudinaryUpload";

const router = Router();

// crew management
router.get("/", authenticateAdmin, getCrew);
router.get("/me", authenticateCrew, getCrewMe);
router.post("/login", loginCrew);

// create crew
router.post("/", crewUpload, uploadCrewFilesToCloudinary, postCrew);

export default router;
