import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

const crewUploadDir = path.join(process.cwd(), "uploads", "crew");
if (!fs.existsSync(crewUploadDir)) {
  fs.mkdirSync(crewUploadDir, { recursive: true });
}

const crewStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, crewUploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const crewUpload = multer({
  storage: crewStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
}).fields([
  { name: "passport_document", maxCount: 1 },
  { name: "identity_document", maxCount: 1 },
]);
