import { Router } from "express";
import { visaController } from "../controllers/visa.controller";

const router = Router();

/**
 * @route POST /api/visa/parse
 * @desc  Parses raw applicant text string into structured VEVO payload JSON
 */
router.post("/parse", visaController.parseRawData);

/**
 * @route POST /api/visa/fetch
 * @desc  Fetches VEVO visa entitlement status and PDF document for single record
 */
router.post("/fetch", visaController.fetchVisaDetails);

/**
 * @route POST /api/visa/batch-fetch
 * @desc  Parses & fetches VEVO status for multiple records in a batch
 */
router.post("/batch-fetch", visaController.batchFetchVisaDetails);

/**
 * @route GET /api/visa/provider
 * @desc  Reports whether the live VEVO provider is configured
 */
router.get("/provider", visaController.getProviderStatus);

/**
 * @route POST /api/visa/check
 * @desc  Runs a live VEVO check via the provider and saves it to the crew record
 */
router.post("/check", visaController.liveCheck);

/**
 * @route POST /api/visa/check-batch
 * @desc  Runs live VEVO checks for many crew and returns expiry verdicts
 */
router.post("/check-batch", visaController.liveBatchCheck);

export default router;
