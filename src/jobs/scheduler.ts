import { runDueJobs } from './jobRunner.js';
import { logger } from '../utils/logger.js';

let started = false;

export function startScheduler() {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await runDueJobs();
    } catch (error) {
      logger.error('Scheduler tick failed', { error: String(error) });
    }
  };

  tick();
  setInterval(tick, 60 * 1000);
}
