import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityService } from '../../src/core/activities.js';
import type { Clock } from '../../src/core/ports.js';
import type { Job } from '../../src/core/types.js';
import { MemoryStorage } from '../../src/storage/memory.js';

class FakeClock implements Clock {
  constructor(private current = new Date('2026-11-14T12:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  set(d: Date): void {
    this.current = d;
  }
}

const START = new Date('2026-11-20T18:00:00Z');
const min = (m: number) => m * 60_000;
const starter = { userId: 'u1', isOfficer: false };
const officer = { userId: 'o1', isOfficer: true };
const stranger = { userId: 'x', isOfficer: false };

let storage: MemoryStorage;
let clock: FakeClock;
let svc: ActivityService;

beforeEach(() => {
  storage = new MemoryStorage();
  clock = new FakeClock();
  svc = new ActivityService({ storage, clock });
});

const FAR = new Date('2027-01-01T00:00:00Z');
const jobsOf = async (type?: Job['type']) =>
  (await storage.dueJobs(FAR)).filter((j) => !type || j.type === type);

function timedEvent(withSignup = true) {
  return svc
    .create({
      guildId: 'g1',
      kind: 'event',
      title: 'Party',
      starter: { userId: 'u1', label: 'S' },
      time: { type: 'at', at: START },
      slots: { participant: null },
      reminderOffsetsMin: [15],
    })
    .then(async (r) => {
      if (withSignup) await svc.signUp(r.activity.id, 'u2', { role: 'participant', label: 'P' });
      return r.activity.id;
    });
}

function asapDungeon() {
  return svc
    .create({
      guildId: 'g1',
      kind: 'dungeon',
      title: 'SM',
      starter: { userId: 'u1', label: 'S' },
      starterRole: 'tank',
      time: { type: 'asap' },
      slots: { tank: 1, healer: 1 },
      reminderOffsetsMin: [15],
    })
    .then((r) => r.activity.id);
}

describe('ActivityService lifecycle', () => {
  it('reminder job reports minutes before start', async () => {
    const id = await timedEvent();
    const [job] = await jobsOf('reminder');
    clock.set(job!.dueAt);
    const r = await svc.runJob(job!);
    expect(r?.effects).toEqual([{ type: 'reminder', minutesBefore: 15 }]);
    expect(id).toBe(r?.activity.id);
  });

  it('reminder 11 minutes overdue is skipped; expire 3 hours overdue still expires', async () => {
    await timedEvent();
    const [reminder] = await jobsOf('reminder');
    clock.set(new Date(reminder!.dueAt.getTime() + min(11)));
    expect(await svc.runJob(reminder!)).toBeNull();

    const id = await asapDungeon();
    const [expire] = await jobsOf('expire');
    clock.set(new Date(expire!.dueAt.getTime() + min(180)));
    const r = await svc.runJob(expire!);
    expect(r?.activity.state).toBe('expired');
    expect(r?.effects).toEqual([{ type: 'closed', reason: 'expired' }]);
    expect((await jobsOf()).filter((j) => j.activityId === id)).toEqual([]);
  });

  it('reminder with no signups is skipped', async () => {
    await timedEvent(false);
    const [job] = await jobsOf('reminder');
    clock.set(job!.dueAt);
    expect(await svc.runJob(job!)).toBeNull();
  });

  it('finish job finishes the activity', async () => {
    await timedEvent();
    const [job] = await jobsOf('finish');
    clock.set(job!.dueAt);
    const r = await svc.runJob(job!);
    expect(r?.activity.state).toBe('finished');
    expect(r?.effects).toEqual([{ type: 'closed', reason: 'finished' }]);
  });

  it('job for an unknown or closed activity returns null', async () => {
    const id = await asapDungeon();
    const [job] = await jobsOf('expire');
    await svc.cancel(id, starter);
    expect(await svc.runJob(job!)).toBeNull();
    expect(await svc.runJob({ ...job!, activityId: 'nope' })).toBeNull();
  });

  it('expire job on a full activity does nothing', async () => {
    const id = await asapDungeon();
    const [expire] = await jobsOf('expire');
    await svc.signUp(id, 'u2', { role: 'healer', label: 'H' });
    clock.set(FAR);
    expect(await svc.runJob(expire!)).toBeNull();
    expect((await svc.get(id))!.activity.state).toBe('full');
  });

  it('asap activity that fills then reopens gets its expire job back', async () => {
    const id = await asapDungeon();
    const createdAt = (await svc.get(id))!.activity.createdAt;
    await svc.signUp(id, 'u2', { role: 'healer', label: 'H' });
    expect((await jobsOf()).map((j) => j.type)).toEqual(['finish']);
    await svc.leave(id, 'u2');
    expect(await jobsOf()).toMatchObject([
      { type: 'expire', dueAt: new Date(createdAt.getTime() + min(120)) },
    ]);
  });

  it('a group that fills again much later finishes 3 hours after the latest fill', async () => {
    const { activity } = await svc.create({
      guildId: 'g1',
      kind: 'dungeon',
      title: 'SM',
      starter: { userId: 'u1', label: 'S' },
      starterRole: 'tank',
      time: { type: 'flexible' },
      slots: { tank: 1, healer: 1 },
      reminderOffsetsMin: [15],
    });
    await svc.signUp(activity.id, 'u2', { role: 'healer', label: 'H' });
    await svc.leave(activity.id, 'u2');
    const refill = new Date(clock.now().getTime() + min(240));
    clock.set(refill);
    await svc.signUp(activity.id, 'u3', { role: 'healer', label: 'H' });
    for (const job of await storage.dueJobs(clock.now())) await svc.runJob(job);
    expect((await svc.get(activity.id))!.activity.state).toBe('full');
    expect(await jobsOf()).toMatchObject([
      { type: 'finish', dueAt: new Date(refill.getTime() + min(180)) },
    ]);
  });

  it('setTime to ASAP or flexible is refused once that limit has passed since posting', async () => {
    const id = await timedEvent();
    const tooOld = 'This group was posted too long ago for that. Set a date and time instead.';
    clock.set(new Date('2026-11-14T14:00:00Z')); // posted 2 hours ago
    await expect(svc.setTime(id, starter, { type: 'asap' })).rejects.toThrow(tooOld);
    const r = await svc.setTime(id, starter, { type: 'flexible' });
    expect(r.activity.time).toEqual({ type: 'flexible' });
    clock.set(new Date('2026-11-21T12:00:00Z')); // posted 7 days ago
    await expect(svc.setTime(id, starter, { type: 'flexible' })).rejects.toThrow(tooOld);
  });

  it('setTime on a flexible activity schedules reminders and emits timeChanged', async () => {
    const r0 = await svc.create({
      guildId: 'g1',
      kind: 'event',
      title: 'Party',
      starter: { userId: 'u1', label: 'S' },
      time: { type: 'flexible' },
      slots: { participant: null },
      reminderOffsetsMin: [15],
    });
    const r = await svc.setTime(r0.activity.id, starter, { type: 'at', at: START });
    expect(r.effects).toEqual([{ type: 'timeChanged' }]);
    expect((await jobsOf()).map((j) => j.type).sort()).toEqual(['finish', 'reminder']);
  });

  it('setTime rejects the past, and non-times for raids', async () => {
    const id = await timedEvent();
    await expect(
      svc.setTime(id, starter, { type: 'at', at: new Date('2026-11-14T11:00:00Z') }),
    ).rejects.toThrow(/in the past/);
    const raid = await svc.create({
      guildId: 'g1',
      kind: 'raid',
      title: 'R',
      starter: { userId: 'u1', label: 'S' },
      time: { type: 'at', at: START },
      slots: { tank: 1 },
      reminderOffsetsMin: [60],
    });
    await expect(svc.setTime(raid.activity.id, starter, { type: 'asap' })).rejects.toThrow(
      'A raid needs a date and time.',
    );
  });

  it('cancel by a stranger rejects; by an officer succeeds and leaves no jobs', async () => {
    const id = await timedEvent();
    await expect(svc.cancel(id, stranger)).rejects.toThrow(
      'Only the starter or an officer can do that.',
    );
    const r = await svc.cancel(id, officer);
    expect(r.activity.state).toBe('cancelled');
    expect(r.effects).toEqual([{ type: 'cancelled' }]);
    expect(await jobsOf()).toEqual([]);
    await expect(svc.cancel(id, officer)).rejects.toThrow('This group is closed.');
    await expect(svc.setTime(id, officer, { type: 'asap' })).rejects.toThrow(
      'This group is closed.',
    );
  });

  it('a due reminder survives a signup or leave before the next tick', async () => {
    const id = await timedEvent();
    const [job] = await jobsOf('reminder');
    clock.set(new Date(job!.dueAt.getTime() + min(1)));
    await svc.signUp(id, 'u3', { role: 'participant', label: 'Q' });
    expect(await jobsOf('reminder')).toMatchObject([{ activityId: id, dueAt: job!.dueAt }]);
    await svc.leave(id, 'u3');
    expect(await jobsOf('reminder')).toMatchObject([{ activityId: id, dueAt: job!.dueAt }]);
  });

  it('a signup at the exact reminder time keeps that reminder once', async () => {
    const id = await timedEvent();
    const [job] = await jobsOf('reminder');
    clock.set(job!.dueAt);
    await svc.signUp(id, 'u3', { role: 'participant', label: 'Q' });
    expect(await jobsOf('reminder')).toMatchObject([{ activityId: id, dueAt: job!.dueAt }]);
  });

  it('runJob deletes the job it ran', async () => {
    await timedEvent();
    const [job] = await jobsOf('reminder');
    clock.set(job!.dueAt);
    await svc.runJob(job!);
    expect(await jobsOf('reminder')).toEqual([]);
  });

  it('a reminder whose offset is not on the activity is ignored', async () => {
    await timedEvent();
    const [job] = await jobsOf('reminder');
    const stale = { ...job!, dueAt: new Date(job!.dueAt.getTime() - min(5)) };
    clock.set(stale.dueAt);
    expect(await svc.runJob(stale)).toBeNull();
  });

  it('an expire job on a timed activity is ignored', async () => {
    const id = await timedEvent();
    clock.set(FAR);
    const r = await svc.runJob({ id: 'x', activityId: id, type: 'expire', dueAt: START });
    expect(r).toBeNull();
    expect((await svc.get(id))!.activity.state).toBe('open');
  });
});

describe('ActivityService.findTarget', () => {
  it("without a message id picks the user's most recent open activity of that kind", async () => {
    const older = await asapDungeon();
    clock.set(new Date('2026-11-14T12:05:00Z'));
    const newer = await asapDungeon();
    clock.set(new Date('2026-11-14T12:10:00Z'));
    await timedEvent(false);
    expect((await svc.findTarget('g1', 'dungeon', 'u1')).id).toBe(newer);
    await svc.cancel(newer, starter);
    expect((await svc.findTarget('g1', 'dungeon', 'u1')).id).toBe(older);
  });

  it('without a message id rejects a user with no open activity of that kind', async () => {
    await asapDungeon();
    await expect(svc.findTarget('g1', 'raid', 'u1')).rejects.toThrow('You have no open raid.');
    await expect(svc.findTarget('g1', 'dungeon', 'u2')).rejects.toThrow(
      'You have no open dungeon.',
    );
  });

  it('with a message id picks that post, whoever started it', async () => {
    const id = await asapDungeon();
    await svc.setPost(id, { channelId: 'c1', messageId: 'm1' });
    expect((await svc.findTarget('g1', 'dungeon', 'o1', 'm1')).id).toBe(id);
  });

  it('with a message id rejects an unknown post or one of another kind or guild', async () => {
    const id = await asapDungeon();
    await svc.setPost(id, { channelId: 'c1', messageId: 'm1' });
    const wrong = 'That is not a link to a raid post.';
    await expect(svc.findTarget('g1', 'raid', 'u1', 'm1')).rejects.toThrow(wrong);
    await expect(svc.findTarget('g1', 'raid', 'u1', 'nope')).rejects.toThrow(wrong);
    await expect(svc.findTarget('g2', 'dungeon', 'u1', 'm1')).rejects.toThrow(
      'That is not a link to a dungeon post.',
    );
  });
});
