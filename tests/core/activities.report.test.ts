import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityService } from '../../src/core/activities.js';
import { MemoryStorage } from '../../src/storage/memory.js';

const starter = { userId: 'u1', isOfficer: false };
const officer = { userId: 'o1', isOfficer: true };
const stranger = { userId: 'x', isOfficer: false };
const FAR = new Date('2027-01-01T00:00:00Z');

let storage: MemoryStorage;
let now: Date;
let svc: ActivityService;

beforeEach(() => {
  storage = new MemoryStorage();
  now = new Date('2026-11-14T12:00:00Z');
  svc = new ActivityService({ storage, clock: { now: () => now } });
});

async function dungeon(): Promise<string> {
  const { activity } = await svc.create({
    guildId: 'g1',
    kind: 'dungeon',
    title: 'Deadmines',
    starter: { userId: 'u1', label: 'S' },
    starterRole: 'tank',
    time: { type: 'at', at: new Date('2026-11-14T18:00:00Z') },
    slots: { tank: 1, healer: 1 },
    reminderOffsetsMin: [15],
  });
  return activity.id;
}

describe('report', () => {
  it('finishes an open activity with the result and the trimmed report', async () => {
    const id = await dungeon();
    const r = await svc.report(id, starter, 'completed', '  Clean run.  ');
    expect(r.activity.state).toBe('finished');
    expect(r.activity.outcome).toBe('completed');
    expect(r.activity.report).toBe('Clean run.');
    expect(r.effects).toEqual([{ type: 'closed', reason: 'finished' }]);
    expect(await storage.dueJobs(FAR)).toEqual([]);
  });

  it('stores no report when it is empty', async () => {
    const r = await svc.report(await dungeon(), starter, 'failed', '   ');
    expect(r.activity.outcome).toBe('failed');
    expect(r.activity.report).toBeUndefined();
  });

  it('lets an officer report and refuses anyone else', async () => {
    const id = await dungeon();
    await expect(svc.report(id, stranger, 'completed')).rejects.toThrow(
      'Only the starter or an officer can do that.',
    );
    expect((await svc.report(id, officer, 'not_happened')).activity.outcome).toBe('not_happened');
  });

  it('adds the result to an activity that was finished automatically', async () => {
    const id = await dungeon();
    now = new Date('2026-11-14T21:00:00Z');
    for (const job of await storage.dueJobs(now)) await svc.runJob(job);
    expect((await svc.get(id))!.activity.state).toBe('finished');
    const r = await svc.report(id, starter, 'completed', 'Late report');
    expect(r.activity.outcome).toBe('completed');
    expect(r.activity.report).toBe('Late report');
  });

  it('refuses a second result and a cancelled activity', async () => {
    const id = await dungeon();
    await svc.report(id, starter, 'completed');
    await expect(svc.report(id, starter, 'failed')).rejects.toThrow(
      'The result is already recorded.',
    );
    const other = await dungeon();
    await svc.cancel(other, starter);
    await expect(svc.report(other, starter, 'failed')).rejects.toThrow('This group is closed.');
  });
});

describe('setLog', () => {
  it('stores the log entry and forgets the removed post', async () => {
    const id = await dungeon();
    await svc.setPost(id, { channelId: 'c1', messageId: 'm1' });
    await svc.setThread(id, 't1');
    await svc.setLog(id, { channelId: 'log', messageId: 'm2' });
    const { activity } = (await svc.get(id))!;
    expect(activity.logChannelId).toBe('log');
    expect(activity.logMessageId).toBe('m2');
    expect(activity.channelId).toBeUndefined();
    expect(activity.messageId).toBeUndefined();
    expect(activity.threadId).toBe('t1');
  });
});
