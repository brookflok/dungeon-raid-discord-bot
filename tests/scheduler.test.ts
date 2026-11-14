import { describe, expect, it } from 'vitest';
import { ActivityService, type ActivityResult } from '../src/core/activities.js';
import type { Clock } from '../src/core/ports.js';
import { Scheduler } from '../src/scheduler.js';
import { MemoryStorage } from '../src/storage/memory.js';

class FakeClock implements Clock {
  constructor(public current = new Date('2026-11-14T12:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
}

function setup() {
  const storage = new MemoryStorage();
  const clock = new FakeClock();
  const activities = new ActivityService({ storage, clock });
  const results: ActivityResult[] = [];
  const scheduler = new Scheduler({
    storage,
    clock,
    activities,
    onResult: (r) => {
      results.push(r);
      return Promise.resolve();
    },
  });
  const create = (title: string) =>
    activities.create({
      guildId: 'g1',
      kind: 'event',
      title,
      starter: { userId: 'u1', label: 'S' },
      time: { type: 'asap' },
      slots: { participant: null },
      reminderOffsetsMin: [],
    });
  return { storage, clock, activities, scheduler, results, create };
}

describe('Scheduler', () => {
  it('tick runs due jobs, reports results and deletes each job', async () => {
    const { storage, clock, scheduler, results, create } = setup();
    const a = await create('A');
    await scheduler.tick();
    expect(results).toEqual([]);
    clock.current = new Date('2026-11-14T15:00:00Z');
    await scheduler.tick();
    expect(results).toHaveLength(1);
    expect(results[0]!.activity.id).toBe(a.activity.id);
    expect(results[0]!.effects).toEqual([{ type: 'closed', reason: 'expired' }]);
    expect(await storage.dueJobs(new Date('2030-01-01'))).toEqual([]);
  });

  it('a failing job is deleted and does not stop the next one', async () => {
    const { storage, clock, activities, scheduler, results, create } = setup();
    await create('A');
    await create('B');
    const real = activities.runJob.bind(activities);
    let calls = 0;
    activities.runJob = (job) => {
      if (calls++ === 0) return Promise.reject(new Error('boom'));
      return real(job);
    };
    clock.current = new Date('2026-11-14T15:00:00Z');
    await scheduler.tick();
    expect(calls).toBe(2);
    expect(results).toHaveLength(1);
    expect(await storage.dueJobs(new Date('2030-01-01'))).toEqual([]);
  });
});
