export interface VevoFetchInput {
  fullName?: string;
  dateOfBirth: string; // Expected format: YYYY-MM-DD
  grantNumber: string;
  passportNumber: string;
  country?: string; // Default: AUS
}

export type VisaStatus = "Active" | "Expired" | "Not Found" | "Invalid Request";

export interface VevoMetadata {
  applicantName: string;
  dateOfBirth: string;
  passportNumber: string;
  grantNumber: string;
  visaStatus: VisaStatus;
  visaClass: string;
  visaSubclass: string;
  expiryDate: string | null;
  workEntitlements: string;
  documentUrl?: string;
  pdfStream?: string; // Base64 encoded PDF document or stream
  verifiedAt: string;
}

export interface VevoApiResponse {
  statusCode: number;
  success: boolean;
  message: string;
  data?: VevoMetadata;
  errors?: string[];
}

export interface RawParseResult {
  parsedCount: number;
  records: VevoFetchInput[];
}
