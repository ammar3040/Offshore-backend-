import { Request, Response, NextFunction } from "express";
import cloudinary, {
  CLOUDINARY_ADMIN_INVOICE_FOLDER,
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
  const passportFile = files?.passport_document?.[0];
  const identityFile = files?.identity_document?.[0];
  const certificateFiles = files?.certificate_document ?? [];
  const hasCertificateFiles = certificateFiles.length > 0;

  if (!passportFile && !identityFile && !hasCertificateFiles) {
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

  try {
    const uploads: Promise<void>[] = [];
    if (passportFile) {
      uploads.push(
        uploadFile(passportFile, `${CLOUDINARY_CREW_FOLDER}/passport`).then(
          (url) => {
            (passportFile as Express.Multer.File & { path?: string }).path = url;
          }
        )
      );
    }
    if (identityFile) {
      uploads.push(
        uploadFile(identityFile, `${CLOUDINARY_CREW_FOLDER}/identity`).then(
          (url) => {
            (identityFile as Express.Multer.File & { path?: string }).path = url;
          }
        )
      );
    }
    for (const certificateFile of certificateFiles) {
      uploads.push(
        uploadFile(certificateFile, `${CLOUDINARY_CREW_FOLDER}/certificate`).then(
          (url) => {
            (certificateFile as Express.Multer.File & { path?: string }).path = url;
          }
        )
      );
    }
    await Promise.all(uploads);
    next();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Cloudinary upload error:", error);
    return res.status(500).json({
      message: "Failed to upload documents to cloud storage.",
    });
  }
}

/** Upload crew files to Cloudinary when present. Used for PATCH - uploads any of the 3 files that are sent. */
export async function uploadCrewFilesToCloudinaryOptional(
  req: Request & { files?: CrewFormFiles },
  res: Response,
  next: NextFunction
) {
  const files = req.files;
  const passportFile = files?.passport_document?.[0];
  const identityFile = files?.identity_document?.[0];
  const certificateFiles = files?.certificate_document ?? [];
  const hasCertificateFiles = certificateFiles.length > 0;

  if (!passportFile && !identityFile && !hasCertificateFiles) {
    return next();
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

  try {
    const uploads: Promise<void>[] = [];
    if (passportFile) {
      uploads.push(
        uploadFile(passportFile, `${CLOUDINARY_CREW_FOLDER}/passport`).then(
          (url) => {
            (passportFile as Express.Multer.File & { path?: string }).path = url;
          }
        )
      );
    }
    if (identityFile) {
      uploads.push(
        uploadFile(identityFile, `${CLOUDINARY_CREW_FOLDER}/identity`).then(
          (url) => {
            (identityFile as Express.Multer.File & { path?: string }).path = url;
          }
        )
      );
    }
    for (const certificateFile of certificateFiles) {
      uploads.push(
        uploadFile(certificateFile, `${CLOUDINARY_CREW_FOLDER}/certificate`).then(
          (url) => {
            (certificateFile as Express.Multer.File & { path?: string }).path = url;
          }
        )
      );
    }
    await Promise.all(uploads);
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
      resource_type: "raw",
      type: "upload",
      access_mode: "public",
      format: "pdf",
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

/** Upload admin invoice PDF to Cloudinary. Expects req.file from multer.single("pdf"). */
export async function uploadAdminInvoicePdfToCloudinary(
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
      folder: CLOUDINARY_ADMIN_INVOICE_FOLDER,
      resource_type: "raw",
      type: "upload",
      access_mode: "public",
      format: "pdf",
    });
    req.uploadedPdfUrl = result.secure_url;
    next();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Cloudinary admin invoice PDF upload error:", error);
    return res.status(500).json({
      message: "Failed to upload invoice PDF to cloud storage.",
    });
  }
}
