import { Request, Response, NextFunction } from "express";
import cloudinary, { CLOUDINARY_CREW_FOLDER } from "../config/cloudinary";

interface CrewFormFiles {
  passport_document?: Express.Multer.File[];
  identity_document?: Express.Multer.File[];
}

export async function uploadCrewFilesToCloudinary(
  req: Request & { files?: CrewFormFiles },
  res: Response,
  next: NextFunction
) {
  const files = req.files;
  if (!files?.passport_document?.[0] || !files?.identity_document?.[0]) {
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
    const [passportFile, identityFile] = [
      files.passport_document[0],
      files.identity_document[0],
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

    const [passportUrl, identityUrl] = await Promise.all([
      uploadFile(passportFile, `${CLOUDINARY_CREW_FOLDER}/passport`),
      uploadFile(identityFile, `${CLOUDINARY_CREW_FOLDER}/identity`),
    ]);

    (passportFile as Express.Multer.File & { path?: string }).path = passportUrl;
    (identityFile as Express.Multer.File & { path?: string }).path = identityUrl;

    next();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Cloudinary upload error:", error);
    return res.status(500).json({
      message: "Failed to upload documents to cloud storage.",
    });
  }
}
