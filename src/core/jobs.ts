import type { Activity, Job } from './types.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const ASAP_EXPIRY_MS = 2 * HOUR;
export const FLEXIBLE_EXPIRY_MS = 7 * DAY;
export const FINISH_AFTER_MS = 3 * HOUR;

/** The jobs an activity needs right now; only open and full activities have any. */
export function planJobs(a: Activity, now: Date): Omit<Job, 'id'>[] {
  if (a.state !== 'open' && a.state !== 'full') return [];
  const job = (type: Job['type'], at: number): Omit<Job, 'id'> => ({
    activityId: a.id,
    type,
    dueAt: new Date(at),
  });

  if (a.time.type === 'at') {
    const start = a.time.at.getTime();
    const jobs = a.reminderOffsetsMin
      .map((offset) => start - offset * MINUTE)
      .filter((at) => at >= now.getTime())
      .map((at) => job('reminder', at));
    jobs.push(job('finish', start + FINISH_AFTER_MS));
    return jobs;
  }
  if (a.state === 'full') {
    return a.filledAt ? [job('finish', a.filledAt.getTime() + FINISH_AFTER_MS)] : [];
  }
  const limit = a.time.type === 'asap' ? ASAP_EXPIRY_MS : FLEXIBLE_EXPIRY_MS;
  return [job('expire', a.createdAt.getTime() + limit)];
}
