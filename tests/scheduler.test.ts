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
  const hold: { gate?: Promise<void> } = {};
  const onResult = (r: ActivityResult): Promise<void> => {
    results.push(r);
    return hold.gate ?? Promise.resolve();
  };
  const scheduler = new Scheduler({ storage, clock, activities, onResult });
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
  const createTimed = async () => {
    const a = await activities.create({
      guildId: 'g1',
      kind: 'event',
      title: 'T',
      starter: { userId: 'u1', label: 'S' },
      time: { type: 'at', at: new Date('2026-11-20T18:00:00Z') },
      slots: { participant: null },
      reminderOffsetsMin: [15],
    });
    await activities.signUp(a.activity.id, 'u2', { role: 'participant', label: 'P' });
    return a.activity.id;
  };
  return { storage, clock, activities, scheduler, results, create, createTimed, hold };
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

  it('a signup before the tick does not lose the reminder; none is sent twice', async () => {
    const { clock, activities, scheduler, results, createTimed } = setup();
    const id = await createTimed();
    clock.current = new Date('2026-11-20T17:46:00Z');
    await activities.signUp(id, 'u3', { role: 'participant', label: 'Q' });
    await scheduler.tick();
    expect(results.map((r) => r.effects)).toEqual([[{ type: 'reminder', minutesBefore: 15 }]]);
    await activities.signUp(id, 'u4', { role: 'participant', label: 'R' });
    await scheduler.tick();
    expect(results).toHaveLength(1);
  });

  it('overlapping ticks deliver a job once', async () => {
    const { clock, scheduler, results, createTimed, hold } = setup();
    await createTimed();
    clock.current = new Date('2026-11-20T17:46:00Z');
    let release!: () => void;
    hold.gate = new Promise<void>((r) => (release = r));
    const first = scheduler.tick();
    const second = scheduler.tick();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([first, second]);
    expect(results).toHaveLength(1);
  });
});
