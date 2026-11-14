import { describe, expect, it } from 'vitest';
import { planJobs } from '../../src/core/jobs.js';
import type { Activity } from '../../src/core/types.js';

const T = new Date('2026-11-20T18:00:00Z');
const created = new Date('2026-11-14T12:00:00Z');
const min = (m: number) => m * 60_000;

function activity(over: Partial<Activity>): Activity {
  return {
    id: 'a1',
    guildId: 'g1',
    kind: 'event',
    title: 'Thing',
    starterId: 'u1',
    time: { type: 'asap' },
    slots: { participant: null },
    reminderOffsetsMin: [60],
    state: 'open',
    createdAt: created,
    ...over,
  };
}

describe('planJobs', () => {
  it('timed raid keeps only future reminders and adds finish', () => {
    const now = new Date(T.getTime() - min(120));
    const jobs = planJobs(
      activity({ kind: 'raid', time: { type: 'at', at: T }, reminderOffsetsMin: [1440, 60] }),
      now,
    );
    expect(jobs).toEqual([
      { activityId: 'a1', type: 'reminder', dueAt: new Date(T.getTime() - min(60)) },
      { activityId: 'a1', type: 'finish', dueAt: new Date(T.getTime() + min(180)) },
    ]);
  });

  it('open asap expires 2 hours after creation', () => {
    expect(planJobs(activity({}), created)).toEqual([
      { activityId: 'a1', type: 'expire', dueAt: new Date(created.getTime() + min(120)) },
    ]);
  });

  it('full asap finishes 3 hours after filling', () => {
    const filledAt = new Date('2026-11-14T13:00:00Z');
    expect(planJobs(activity({ state: 'full', filledAt }), filledAt)).toEqual([
      { activityId: 'a1', type: 'finish', dueAt: new Date(filledAt.getTime() + min(180)) },
    ]);
  });

  it('open flexible expires 7 days after creation', () => {
    expect(planJobs(activity({ time: { type: 'flexible' } }), created)).toEqual([
      { activityId: 'a1', type: 'expire', dueAt: new Date(created.getTime() + min(7 * 1440)) },
    ]);
  });

  it('closed activities have no jobs', () => {
    expect(planJobs(activity({ state: 'cancelled' }), created)).toEqual([]);
  });
});
