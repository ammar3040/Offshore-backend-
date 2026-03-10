import multer from "multer";

const crewStorage = multer.memoryStorage();

export const crewUpload = multer({
  storage: crewStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
}).fields([
  { name: "passport_document", maxCount: 1 },
  { name: "identity_document", maxCount: 1 },
  { name: "certificate_document", maxCount: 50 },
]);

/** Single PDF file for crew ticket upload - field name "pdf" */
export const crewTicketPdfUpload = multer({
  storage: crewStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
}).single("pdf");
