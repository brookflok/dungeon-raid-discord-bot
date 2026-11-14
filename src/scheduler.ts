import type { ActivityResult, ActivityService } from './core/activities.js';
import type { Clock, Storage } from './core/ports.js';
import { log } from './log.js';

export class Scheduler {
  private readonly storage: Storage;
  private readonly clock: Clock;
  private readonly activities: ActivityService;
  private readonly onResult: (r: ActivityResult) => Promise<void>;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;

  constructor(deps: {
    storage: Storage;
    clock: Clock;
    activities: ActivityService;
    onResult: (r: ActivityResult) => Promise<void>;
    intervalMs?: number;
  }) {
    this.storage = deps.storage;
    this.clock = deps.clock;
    this.activities = deps.activities;
    this.onResult = deps.onResult;
    this.intervalMs = deps.intervalMs ?? 30_000;
  }

  /** Runs every due job once and deletes it; one failing job does not stop the others. Skipped while a tick is running. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const job of await this.storage.dueJobs(this.clock.now())) {
        try {
          const result = await this.activities.runJob(job);
          if (result) await this.onResult(result);
        } catch (err) {
          log.error('Scheduled job failed', { jobId: job.id, err });
        }
        await this.storage.deleteJob(job.id);
      }
    } finally {
      this.ticking = false;
    }
  }

  start(): void {
    if (this.timer) return;
    const run = (): void => {
      this.tick().catch((err: unknown) => log.error('Scheduler tick failed', { err }));
    };
    run();
    this.timer = setInterval(run, this.intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
