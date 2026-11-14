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
  private ticking: Promise<void> | undefined;

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
  tick(): Promise<void> {
    if (this.ticking) return Promise.resolve();
    this.ticking = this.runDueJobs().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }

  private async runDueJobs(): Promise<void> {
    for (const job of await this.storage.dueJobs(this.clock.now())) {
      try {
        const result = await this.activities.runJob(job);
        if (result) await this.onResult(result);
      } catch (err) {
        log.error('Scheduled job failed', { jobId: job.id, err });
      }
      await this.storage.deleteJob(job.id);
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

  /** Stops ticking; resolves once a running tick has finished. A failed tick was logged by start. */
  stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    return this.ticking?.catch(() => undefined) ?? Promise.resolve();
  }
}
