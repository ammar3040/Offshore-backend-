import { Router } from "express";
import { postCrew } from "../controllers";
import { crewUpload } from "../middleware/upload";
import { uploadCrewFilesToCloudinary } from "../middleware/cloudinaryUpload";

const router = Router();

router.post("/", crewUpload, uploadCrewFilesToCloudinary, postCrew);

export default router;
