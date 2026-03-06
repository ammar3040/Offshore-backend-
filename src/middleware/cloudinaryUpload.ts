import { Request, Response, NextFunction } from "express";
import cloudinary, {
  CLOUDINARY_CREW_FOLDER,
  CLOUDINARY_CREW_TICKET_FOLDER,
} from "../config/cloudinary";

interface CrewFormFiles {
  passport_document?: Express.Multer.File[];
  identity_document?: Express.Multer.File[];
  certificate_document?: Express.Multer.File[];
}

export async function uploadCrewFilesToCloudinary(
  req: Request & { files?: CrewFormFiles },
  res: Response,
  next: NextFunction
) {
  const files = req.files;
  if (!files?.passport_document?.[0] || !files?.identity_document?.[0] || !files?.certificate_document?.[0]) {
    return next();
  }

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return res.status(500).json({
      message: "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    });
  }

  try {
    const [passportFile, identityFile, certificateFile] = [
      files.passport_document[0],
      files.identity_document[0],
      files.certificate_document[0],
    ];

    const uploadFile = async (
      file: Express.Multer.File,
      folder: string
    ): Promise<string> => {
      const b64 = file.buffer.toString("base64");
      const dataUri = `data:${file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataUri, {
        folder,
        resource_type: "auto",
      });
      return result.secure_url;
    };

    const [passportUrl, identityUrl, certificateUrl] = await Promise.all([
      uploadFile(passportFile, `${CLOUDINARY_CREW_FOLDER}/passport`),
      uploadFile(identityFile, `${CLOUDINARY_CREW_FOLDER}/identity`),
      uploadFile(certificateFile, `${CLOUDINARY_CREW_FOLDER}/certificate`),
    ]);

    (passportFile as Express.Multer.File & { path?: string }).path = passportUrl;
    (identityFile as Express.Multer.File & { path?: string }).path = identityUrl;
    (certificateFile as Express.Multer.File & { path?: string }).path = certificateUrl;

    next();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Cloudinary upload error:", error);
    return res.status(500).json({
      message: "Failed to upload documents to cloud storage.",
    });
  }
}

/** Upload crew ticket PDF to Cloudinary. Expects req.file from multer.single("pdf"). */
export async function uploadCrewTicketPdfToCloudinary(
  req: Request & { file?: Express.Multer.File } & { uploadedPdfUrl?: string },
  res: Response,
  next: NextFunction
) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: "PDF file is required. Send as form field 'pdf'." });
  }

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return res.status(500).json({
      message:
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    });
  }

  try {
    const b64 = file.buffer.toString("base64");
    const dataUri = `data:${file.mimetype};base64,${b64}`;
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: CLOUDINARY_CREW_TICKET_FOLDER,
      resource_type: "auto",
    });
    req.uploadedPdfUrl = result.secure_url;
    next();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Cloudinary crew ticket PDF upload error:", error);
    return res.status(500).json({
      message: "Failed to upload ticket PDF to cloud storage.",
    });
  }
}
