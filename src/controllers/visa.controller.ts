import { Request, Response } from "express";
import { parseRawClientText } from "../utils/vevoParser";
import { vevoService } from "../services/vevo.service";
import { VevoFetchInput } from "../types/vevo.types";

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
}

export const visaController = new VisaController();
