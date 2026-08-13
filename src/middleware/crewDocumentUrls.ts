import { Request, Response, NextFunction } from "express";
import { CLOUDINARY_CREW_FOLDER } from "../config/cloudinary";

type CrewFormFiles = {
  passport_document?: Express.Multer.File[];
  identity_document?: Express.Multer.File[];
  certificate_document?: Express.Multer.File[];
};

function getCloudName(): string {
  return (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
}

/** Only accept URLs from our Cloudinary account under the crew folder. */
export function isAllowedCrewDocumentUrl(url: string): boolean {
  const cloud = getCloudName();
  if (!cloud || !url) return false;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "res.cloudinary.com") return false;
    const prefix = `/${cloud}/`;
    if (!parsed.pathname.startsWith(prefix)) return false;
    return parsed.pathname.includes(`/${CLOUDINARY_CREW_FOLDER}/`);
  } catch {
    return false;
  }
}

function hasUploadedBuffer(file?: Express.Multer.File): boolean {
  return Boolean(file?.buffer && file.buffer.length > 0);
}

function syntheticFile(url: string, fieldname: string): Express.Multer.File & { path: string } {
  return {
    fieldname,
    originalname: "remote-upload",
    encoding: "7bit",
    mimetype: "application/octet-stream",
    size: 0,
    buffer: Buffer.alloc(0),
    destination: "",
    filename: "",
    path: url.trim(),
    stream: undefined as unknown as Express.Multer.File["stream"],
  };
}

function readUrlField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readUrlList(body: Record<string, unknown>): string[] | undefined {
  const multi = body.certificate_document_urls;
  if (typeof multi === "string" && multi.trim()) {
    try {
      const parsed = JSON.parse(multi) as unknown;
      if (!Array.isArray(parsed)) return undefined;
      return parsed.map((u) => String(u).trim()).filter(Boolean);
    } catch {
      return undefined;
    }
  }
  const single = readUrlField(body, "certificate_document_url");
  return single ? [single] : undefined;
}

/**
 * After multer parses multipart fields, map Cloudinary URLs (uploaded client-side)
 * onto req.files[].path so create/update can skip sending large binaries through Vercel.
 */
export function applyCrewDocumentUrlsFromBody(
  req: Request & { files?: CrewFormFiles },
  res: Response,
  next: NextFunction
) {
  const body = (req.body || {}) as Record<string, unknown>;
  const files: CrewFormFiles = { ...(req.files || {}) };
  req.files = files;

  const passportUrl = readUrlField(body, "passport_document_url");
  const identityUrl = readUrlField(body, "identity_document_url");
  const certificateUrls = readUrlList(body);

  const invalid: string[] = [];
  if (passportUrl && !isAllowedCrewDocumentUrl(passportUrl)) invalid.push("passport_document_url");
  if (identityUrl && !isAllowedCrewDocumentUrl(identityUrl)) invalid.push("identity_document_url");
  if (certificateUrls?.some((u) => !isAllowedCrewDocumentUrl(u))) {
    invalid.push("certificate_document_urls");
  }
  if (invalid.length > 0) {
    return res.status(400).json({
      message: `Invalid document URL(s): ${invalid.join(", ")}. Upload via signed Cloudinary flow only.`,
    });
  }

  if (passportUrl && !hasUploadedBuffer(files.passport_document?.[0])) {
    files.passport_document = [syntheticFile(passportUrl, "passport_document")];
  }
  if (identityUrl && !hasUploadedBuffer(files.identity_document?.[0])) {
    files.identity_document = [syntheticFile(identityUrl, "identity_document")];
  }
  if (certificateUrls?.length && !(files.certificate_document ?? []).some(hasUploadedBuffer)) {
    files.certificate_document = certificateUrls.map((url, i) =>
      syntheticFile(url, `certificate_document_${i}`)
    );
  }

  next();
}
