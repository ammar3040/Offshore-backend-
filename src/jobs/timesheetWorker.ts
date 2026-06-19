import cron from "node-cron";
import { markTodayPresentForAllTimesheets } from "../models/timesheet.model";

/** Cron schedule: every day at 00:05 UTC */
const DAILY_CRON = "5 0 * * *";

let scheduled = false;

export function startTimesheetWorker(): void {
  if (scheduled) return;
  scheduled = true;

  cron.schedule(DAILY_CRON, async () => {
    try {
      const result = await markTodayPresentForAllTimesheets();
      // eslint-disable-next-line no-console
      console.log(`[Timesheet worker] Marked PRESENT for ${result.updated} timesheet(s)`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Timesheet worker] Error:", err);
    }
  });

  // eslint-disable-next-line no-console
  console.log(`[Timesheet worker] Scheduled daily at 00:05 UTC`);
}
