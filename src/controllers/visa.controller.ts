import { Request, Response } from "express";
import { parseRawClientText } from "../utils/vevoParser";
import { vevoService } from "../services/vevo.service";
import { VevoFetchInput } from "../types/vevo.types";
import { CrewModel } from "../models/crew.model";
import {
  evaluateExpiry,
  providerStatus,
  runLiveVevoCheck,
  VsureError,
  type LiveVevoCheck,
  type VsureCheckInput,
} from "../services/vsure.service";

interface LiveCheckRequest extends VsureCheckInput {
  crewId?: string;
  saveToCrew?: boolean;
}

/** Writes a completed live check back onto the crew member's visa details. */
async function persistCheckToCrew(crewId: string, check: LiveVevoCheck): Promise<boolean> {
  const { metadata } = check;
  const update: Record<string, string> = {
    "visa_details.vevo_document_type": "Passport",
    "visa_details.last_vevo_checked_at": new Date().toISOString().slice(0, 10),
  };

  if (metadata.expiryDate) update["visa_details.visa_expiry_date"] = metadata.expiryDate;
  if (metadata.grantDate) update["visa_details.visa_issue_date"] = metadata.grantDate;
  if (metadata.grantNumber) {
    update["visa_details.vevo_reference_type"] = "Visa Grant Number";
    update["visa_details.vevo_reference_number"] = metadata.grantNumber;
  }

  const subclass = [metadata.visaClass, metadata.visaSubclass].filter(Boolean).join(" / ");
  if (subclass) update["visa_details.visa_subclass"] = subclass;

  const conditions = [metadata.workEntitlements, metadata.visaConditions, metadata.periodOfStay]
    .filter(Boolean)
    .join("\n");
  if (conditions) update["visa_details.visa_conditions"] = conditions;

  const result = await CrewModel.findByIdAndUpdate(crewId, { $set: update }, { new: true });
  return Boolean(result);
}

function describeLiveCheck(check: LiveVevoCheck) {
  const expiry = evaluateExpiry(check.metadata.expiryDate);
  return {
    checkId: check.checkId,
    resultCode: check.resultCode,
    data: check.metadata,
    expiry,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Controller to handle Visa & VEVO Document Verification operations
 */
export class VisaController {
  /**
   * POST /api/visa/parse
   * Parses raw client text into clean VevoFetchInput JSON structure.
   */
  public parseRawData = async (req: Request, res: Response): Promise<void> => {
    try {
      const rawText = typeof req.body === "string" ? req.body : req.body.rawText || req.body.text || "";

      if (!rawText) {
        res.status(400).json({
          statusCode: 400,
          success: false,
          message: "Bad Request: No rawText or text body provided.",
        });
        return;
      }

      const parsedRecords = parseRawClientText(rawText);

      res.status(200).json({
        statusCode: 200,
        success: true,
        message: `Successfully parsed ${parsedRecords.length} applicant record(s).`,
        count: parsedRecords.length,
        records: parsedRecords,
      });
    } catch (error: any) {
      console.error("[VisaController] parseRawData Error:", error);
      res.status(500).json({
        statusCode: 500,
        success: false,
        message: "Internal Server Error while parsing raw client data.",
        error: error?.message || error,
      });
    }
  };

  /**
   * POST /api/visa/fetch
   * Submits applicant details to VEVO API and fetches visa status & entitlement document.
   */
  public fetchVisaDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload: VevoFetchInput = req.body;

      console.log(`[VisaController] Incoming VEVO Fetch Request:`, JSON.stringify(payload));

      const response = await vevoService.fetchVisaDetails(payload);

      // Log API HTTP Status Code as required
      console.log(`[VisaController] VEVO Response HTTP Code: ${response.statusCode}`);

      res.status(response.statusCode).json(response);
    } catch (error: any) {
      console.error("[VisaController] fetchVisaDetails Error:", error);
      res.status(500).json({
        statusCode: 500,
        success: false,
        message: "Internal Server Error during VEVO fetch operation.",
        error: error?.message || error,
      });
    }
  };

  /**
   * POST /api/visa/batch-fetch
   * Processes batch applicant records or raw text, fetching VEVO details for each.
   */
  public batchFetchVisaDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      let records: VevoFetchInput[] = [];

      if (Array.isArray(req.body.records)) {
        records = req.body.records;
      } else if (req.body.rawText || typeof req.body === "string") {
        const text = typeof req.body === "string" ? req.body : req.body.rawText;
        records = parseRawClientText(text);
      }

      if (!records || records.length === 0) {
        res.status(400).json({
          statusCode: 400,
          success: false,
          message: "Bad Request: No valid records provided for batch processing.",
        });
        return;
      }

      const results = [];
      for (const record of records) {
        const result = await vevoService.fetchVisaDetails(record);
        results.push({
          inputPayload: record,
          httpStatusCode: result.statusCode,
          vevoResponse: result,
        });
      }

      res.status(200).json({
        statusCode: 200,
        success: true,
        message: `Processed batch VEVO check for ${results.length} applicant records.`,
        totalProcessed: results.length,
        results,
      });
    } catch (error: any) {
      console.error("[VisaController] batchFetchVisaDetails Error:", error);
      res.status(500).json({
        statusCode: 500,
        success: false,
        message: "Internal Server Error during batch VEVO fetch operation.",
        error: error?.message || error,
      });
    }
  };

  /**
   * GET /api/visa/provider
   * Reports whether live VEVO checks are wired up, so the UI can say so plainly.
   */
  public getProviderStatus = async (_req: Request, res: Response): Promise<void> => {
    const status = providerStatus();
    res.status(200).json({
      statusCode: 200,
      success: true,
      message: status.configured
        ? `Live VEVO checks enabled via ${status.provider} (${status.environment}).`
        : "Live VEVO checks are not configured.",
      provider: status,
    });
  };

  /**
   * POST /api/visa/check
   * Runs one live VEVO check through the provider and optionally saves it to the crew record.
   */
  public liveCheck = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as LiveCheckRequest;

    try {
      const input: VsureCheckInput = {
        fullName: body.fullName,
        dateOfBirth: (body.dateOfBirth ?? "").trim(),
        passportNumber: (body.passportNumber ?? "").trim(),
        country: body.country,
        grantNumber: body.grantNumber,
      };

      const check = await runLiveVevoCheck(input);
      const described = describeLiveCheck(check);

      let crewUpdated = false;
      if (body.crewId && body.saveToCrew !== false && check.resultCode === "SUCCESS") {
        crewUpdated = await persistCheckToCrew(body.crewId, check);
      }

      res.status(200).json({
        statusCode: 200,
        success: check.resultCode === "SUCCESS",
        message:
          check.resultCode === "SUCCESS"
            ? `Visa ${described.data.visaStatus.toLowerCase()} — ${described.expiry.verdict}.`
            : `VEVO returned ${check.resultCode}.`,
        provider: providerStatus(),
        crewId: body.crewId ?? null,
        crewUpdated,
        ...described,
      });
    } catch (error: any) {
      if (error instanceof VsureError) {
        console.error(`[VisaController] liveCheck ${error.code}:`, error.message);
        res.status(error.httpStatus).json({
          statusCode: error.httpStatus,
          success: false,
          code: error.code,
          message: error.message,
          provider: providerStatus(),
        });
        return;
      }

      console.error("[VisaController] liveCheck Error:", error);
      res.status(500).json({
        statusCode: 500,
        success: false,
        message: "Internal Server Error during live VEVO check.",
        error: error?.message || error,
      });
    }
  };

  /**
   * POST /api/visa/check-batch
   * Runs live checks for many people, one at a time to stay inside provider rate limits.
   * Accepts { records: [...] } and/or { crewIds: [...] }.
   */
  public liveBatchCheck = async (req: Request, res: Response): Promise<void> => {
    try {
      const records: LiveCheckRequest[] = Array.isArray(req.body?.records) ? [...req.body.records] : [];

      if (Array.isArray(req.body?.crewIds) && req.body.crewIds.length > 0) {
        const crew = await CrewModel.find({ _id: { $in: req.body.crewIds } });
        crew.forEach((member) => {
          records.push({
            crewId: String(member._id),
            fullName: `${member.firstname ?? ""} ${member.lastname ?? ""}`.trim(),
            dateOfBirth: member.dateOfBirth ? new Date(member.dateOfBirth).toISOString().slice(0, 10) : "",
            passportNumber: member.passport?.passport_number ?? "",
            country: member.visa_details?.visa_country ?? "",
            grantNumber: member.visa_details?.vevo_reference_number ?? "",
          });
        });
      }

      if (records.length === 0) {
        res.status(400).json({
          statusCode: 400,
          success: false,
          message: "Bad Request: provide records[] or crewIds[] to check.",
        });
        return;
      }

      const results: unknown[] = [];
      const summary = { total: records.length, valid: 0, expiring: 0, expired: 0, failed: 0 };

      for (const [index, record] of records.entries()) {
        if (index > 0) await sleep(600);

        try {
          const check = await runLiveVevoCheck(record);
          const described = describeLiveCheck(check);

          let crewUpdated = false;
          if (record.crewId && record.saveToCrew !== false && check.resultCode === "SUCCESS") {
            crewUpdated = await persistCheckToCrew(record.crewId, check);
          }

          if (described.expiry.verdict === "expired") summary.expired += 1;
          else if (described.expiry.verdict === "expiring") summary.expiring += 1;
          else if (described.expiry.verdict === "valid") summary.valid += 1;
          else summary.failed += 1;

          results.push({
            crewId: record.crewId ?? null,
            crewUpdated,
            applicant: { ...record },
            success: check.resultCode === "SUCCESS",
            ...described,
          });
        } catch (error: any) {
          summary.failed += 1;
          const isProviderError = error instanceof VsureError;
          results.push({
            crewId: record.crewId ?? null,
            applicant: { ...record },
            success: false,
            code: isProviderError ? error.code : "CHECK_FAILED",
            message: isProviderError ? error.message : (error?.message ?? "Check failed"),
          });

          // A configuration or auth problem will fail identically for everyone else.
          if (isProviderError && ["VSURE_NOT_CONFIGURED", "VSURE_AUTH_FAILED"].includes(error.code)) break;
        }
      }

      res.status(200).json({
        statusCode: 200,
        success: summary.failed < summary.total,
        message: `Checked ${summary.total - summary.failed} of ${summary.total} on VEVO.`,
        provider: providerStatus(),
        summary,
        results,
      });
    } catch (error: any) {
      console.error("[VisaController] liveBatchCheck Error:", error);
      res.status(500).json({
        statusCode: 500,
        success: false,
        message: "Internal Server Error during batch live VEVO check.",
        error: error?.message || error,
      });
    }
  };
}

export const visaController = new VisaController();
