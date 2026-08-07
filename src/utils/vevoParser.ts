import { VevoFetchInput } from "../types/vevo.types";

/**
 * Normalizes a date string into standard ISO format (YYYY-MM-DD).
 * Supports formats like "27 October 1974", "27 Oct 1974", "1974-10-27", "27/10/1974".
 */
export function normalizeDateToISO(rawDate: string): string {
  if (!rawDate) return "";

  const trimmed = rawDate.trim();

  // Check if already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Parse natural date strings like "27 October 1974" or "12 January 1981"
  const parsedDate = new Date(trimmed);
  if (!isNaN(parsedDate.getTime())) {
    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
    const day = String(parsedDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return trimmed;
}

/**
 * Parses raw unformatted or formatted text block containing client/applicant VEVO details into clean VevoFetchInput array.
 */
export function parseRawClientText(rawText: string): VevoFetchInput[] {
  if (!rawText || typeof rawText !== "string") {
    return [];
  }

  // Split text into record blocks (by Record headers or double newlines)
  const recordBlocks = rawText
    .split(/(?:Record\s+\d+:?|(?:\r?\n){2,})/i)
    .map((block) => block.trim())
    .filter(Boolean);

  const results: VevoFetchInput[] = [];

  for (const block of recordBlocks) {
    const nameMatch = block.match(/(?:Name|Full\s*Name):\s*([^\r\n]+)/i);
    const dobMatch = block.match(/(?:Date\s*of\s*Birth|DOB):\s*([^\r\n]+)/i);
    const grantMatch = block.match(/(?:Grant\s*Number|Visa\s*Grant\s*Number):\s*([^\r\n]+)/i);
    const passportMatch = block.match(/(?:Passport\s*Number|Passport):\s*([^\r\n]+)/i);
    const countryMatch = block.match(/(?:Country):\s*([^\r\n]+)/i);

    const dateOfBirth = dobMatch ? normalizeDateToISO(dobMatch[1]) : "";
    const grantNumber = grantMatch ? grantMatch[1].trim() : "";
    const passportNumber = passportMatch ? passportMatch[1].trim() : "";

    // Require at minimum DOB, Grant Number, and Passport Number
    if (dateOfBirth || grantNumber || passportNumber) {
      results.push({
        fullName: nameMatch ? nameMatch[1].trim() : "N/A",
        dateOfBirth,
        grantNumber,
        passportNumber,
        country: countryMatch ? countryMatch[1].trim().toUpperCase() : "GBR",
      });
    }
  }

  return results;
}
