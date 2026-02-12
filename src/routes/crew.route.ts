import { Router } from "express";
import { getCrew, postCrew } from "../controllers";
import { crewUpload } from "../middleware/upload";
import { uploadCrewFilesToCloudinary } from "../middleware/cloudinaryUpload";

const router = Router();

router.get("/", getCrew);
router.post("/", crewUpload, uploadCrewFilesToCloudinary, postCrew);

export default router;
