import cloudinary from "../config/cloudinary";

type CloudinaryResourceType = "image" | "raw" | "video";

export interface ParsedCloudinaryUrl {
  cloudName: string;
  resourceType: CloudinaryResourceType;
  publicId: string;
  format?: string;
}

/** Parse a Cloudinary delivery URL into resource metadata (upload, authenticated, or private). */
export function parseCloudinaryUrl(url: string): ParsedCloudinaryUrl | null {
  const match = url.match(
    /^https?:\/\/res\.cloudinary\.com\/([^/]+)\/(image|raw|video)\/(?:upload|authenticated|private)\/(?:s--[^/]+--\/|v\d+\/)*(.+)$/i
  );
  if (!match) return null;

  const [, cloudName, resourceType, pathWithExt] = match;
  const lastDot = pathWithExt.lastIndexOf(".");
  const format = lastDot > 0 ? pathWithExt.slice(lastDot + 1) : undefined;
  const publicId = lastDot > 0 ? pathWithExt.slice(0, lastDot) : pathWithExt;

  return {
    cloudName,
    resourceType: resourceType as CloudinaryResourceType,
    publicId,
    format,
  };
}

function signedDeliveryUrl(parsed: ParsedCloudinaryUrl): string {
  return cloudinary.url(parsed.publicId, {
    resource_type: parsed.resourceType,
    type: "upload",
    secure: true,
    sign_url: true,
    ...(parsed.format ? { format: parsed.format } : {}),
  });
}

/** Browser-safe delivery URL for a stored Cloudinary asset (requires API secret to sign). */
export function getSignedCloudinaryDeliveryUrl(secureUrl: string): string | null {
  const parsed = parseCloudinaryUrl(secureUrl);
  if (!parsed) return null;

  const configuredCloud = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  if (configuredCloud && parsed.cloudName !== configuredCloud) {
    return null;
  }

  return signedDeliveryUrl(parsed);
}

function privateDownloadUrl(parsed: ParsedCloudinaryUrl): string {
  const format = parsed.format ?? "pdf";
  return cloudinary.utils.private_download_url(parsed.publicId, format, {
    resource_type: parsed.resourceType,
    type: "upload",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
}

async function fetchBufferFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cloudinary download failed with status ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Download a Cloudinary asset using signed/authenticated URLs (server-side credentials).
 * Avoids nodemailer fetching a public URL that may return 401.
 */
export async function fetchCloudinaryAssetBuffer(secureUrl: string): Promise<Buffer> {
  const parsed = parseCloudinaryUrl(secureUrl);
  if (!parsed) {
    throw new Error("Invalid Cloudinary URL.");
  }

  const configuredCloud = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  if (configuredCloud && parsed.cloudName !== configuredCloud) {
    throw new Error("Cloudinary URL cloud name does not match configured account.");
  }

  try {
    return await fetchBufferFromUrl(signedDeliveryUrl(parsed));
  } catch (signedError) {
    try {
      return await fetchBufferFromUrl(privateDownloadUrl(parsed));
    } catch {
      throw signedError;
    }
  }
}
