import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const IV_LENGTH = 16;

function getCleanSecret(): string {
  let secret = process.env.AES_SECRET || "default_dev_secret_key_32_characters";
  // Strip enclosing quotes if present (common copy-paste issue on cloud hosts)
  if (
    (secret.startsWith('"') && secret.endsWith('"')) ||
    (secret.startsWith("'") && secret.endsWith("'"))
  ) {
    secret = secret.slice(1, -1);
  }
  return secret.trim();
}

function getKey(): Buffer {
  const secret = getCleanSecret();
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Decrypts a base64 encoded AES-256-GCM encrypted payload
 */
export function decryptPayload(encryptedBase64: string): any {
  try {
    if (!encryptedBase64 || typeof encryptedBase64 !== "string") {
      throw new Error("No encrypted payload provided");
    }
    const raw = Buffer.from(encryptedBase64, "base64");
    if (raw.length < IV_LENGTH + 16) {
      throw new Error("Encrypted payload too short");
    }
    const iv = raw.slice(0, IV_LENGTH);
    const cipherText = raw.slice(IV_LENGTH);

    const key = getKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);

    // AuthTag is the last 16 bytes
    const tag = cipherText.slice(cipherText.length - 16);
    const data = cipherText.slice(0, cipherText.length - 16);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch (err: any) {
    if (
      err.message &&
      (err.message.includes("Unsupported state") ||
        err.message.includes("unable to authenticate data"))
    ) {
      throw new Error(
        "Failed to decrypt: authentication failed or corrupted data"
      );
    }
    throw err;
  }
}

/**
 * Encrypts a JSON payload using AES-256-GCM
 */
export function encryptPayload(payload: any): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getKey();

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload)),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const combined = Buffer.concat([iv, encrypted, tag]);
    return combined.toString("base64");
  } catch (err: any) {
    throw new Error("Encryption failed: " + err.message);
  }
}

/**
 * Global middleware to handle request body decryption and response body encryption
 */
export function encryptionMiddleware(req: Request, res: Response, next: NextFunction) {
  const isEncryptionEnabled = process.env.ENABLE_ENCRYPTION === "true";

  if (!isEncryptionEnabled) {
    return next();
  }

  // 1. Decrypt request body if wrapped in { data: "..." }
  if (req.body && req.body.data && typeof req.body.data === "string") {
    try {
      req.body = decryptPayload(req.body.data);
    } catch (err: any) {
      console.error("Global request decryption error:", err.message);
      return res.status(400).json({ error: "Invalid encrypted payload" });
    }
  }

  // 2. Intercept res.json to automatically encrypt response body
  const originalJson = res.json;
  res.json = function (body: any): Response {
    // Determine if it is an error response or a redirect/error status code
    const isError =
      res.statusCode >= 300 ||
      (body && (body.error !== undefined || (body.message !== undefined && res.statusCode >= 300)));

    // Only encrypt success responses that are objects and not already wrapped in a data/error field
    if (!isError && body && typeof body === "object" && body.data === undefined) {
      try {
        const encrypted = encryptPayload(body);
        return originalJson.call(this, { data: encrypted });
      } catch (err: any) {
        console.error("Global response encryption error:", err.message);
        return originalJson.call(this, { error: "Encryption failed" });
      }
    }

    return originalJson.call(this, body);
  };

  next();
}
