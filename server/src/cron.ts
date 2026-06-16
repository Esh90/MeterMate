import cron from 'node-cron';
import { config } from './config.js';
import { CONSULTANTS } from './constants.js';
import { postDigest } from './routes/digest.js';

/**
 * Optional scheduled digest (plan §2 UC6, §8 Phase 7) — dormant unless
 * DIGEST_CRON_ENABLED=true. When enabled, runs DIGEST_CRON and posts each
 * consultant's digest to the digest channel. The manual POST /api/digest route
 * is the primary trigger; this is a flagged convenience.
 */
let task: cron.ScheduledTask | null = null;

export function startDigestCron(): void {
  if (!config.DIGEST_CRON_ENABLED) return;
  if (!cron.validate(config.DIGEST_CRON)) {
    console.warn(`[cron] invalid DIGEST_CRON '${config.DIGEST_CRON}'; digest cron not started.`);
    return;
  }
  task = cron.schedule(config.DIGEST_CRON, () => {
    void (async () => {
      for (const consultant of CONSULTANTS) {
        try {
          const { posted } = await postDigest(consultant.id, 30);
          console.log(`[cron] digest for ${consultant.id} posted=${posted}`);
        } catch (err) {
          console.error(`[cron] digest for ${consultant.id} failed:`, err);
        }
      }
    })();
  });
  console.log(`[cron] digest cron scheduled: ${config.DIGEST_CRON}`);
}

export function stopDigestCron(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
