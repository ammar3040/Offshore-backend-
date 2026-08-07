export interface VevoFetchInput {
  fullName?: string;
  dateOfBirth: string; // Expected format: YYYY-MM-DD
  grantNumber: string;
  passportNumber: string;
  /** ISO country of document — default GBR (UNITED KINGDOM - BRITISH CITIZEN) */
  country?: string;
}

export type VisaStatus = "Active" | "Expired" | "Not Found" | "Invalid Request";

export interface VevoMetadata {
  applicantName: string;
  dateOfBirth: string;
  passportNumber: string;
  grantNumber: string;
  countryOfDocument?: string;
  visaStatus: VisaStatus;
  visaClass: string;
  visaSubclass: string;
  visaStream?: string;
  grantDate?: string | null;
  expiryDate: string | null;
  workEntitlements: string;
  visaConditions?: string;
  periodOfStay?: string;
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
