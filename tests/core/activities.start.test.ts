import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityService } from '../../src/core/activities.js';
import { MemoryStorage } from '../../src/storage/memory.js';

const starter = { userId: 'u1', isOfficer: false };
const FAR = new Date('2027-01-01T00:00:00Z');

let storage: MemoryStorage;
let now: Date;
let svc: ActivityService;

beforeEach(() => {
  storage = new MemoryStorage();
  now = new Date('2026-11-14T12:00:00Z');
  svc = new ActivityService({ storage, clock: { now: () => now } });
});

/** A dungeon for tomorrow with the starter as tank and `others` more members as DPS. */
async function dungeon(others: number): Promise<string> {
  const { activity } = await svc.create({
    guildId: 'g1',
    kind: 'dungeon',
    title: 'Deadmines',
    starter: { userId: 'u1', label: 'S' },
    starterRole: 'tank',
    time: { type: 'at', at: new Date('2026-11-15T18:00:00Z') },
    slots: { tank: 1, healer: 1, dps: 3 },
    reminderOffsetsMin: [15],
  });
  for (let n = 0; n < others; n++) {
    await svc.signUp(activity.id, `d${n}`, { role: 'dps', label: `D${n}` });
  }
  return activity.id;
}

describe('startNow', () => {
  it('starts an unfilled group, closes sign-ups and finishes it 3 hours later', async () => {
    const id = await dungeon(2);
    const r = await svc.startNow(id, starter);
    expect(r.effects).toEqual([{ type: 'started' }]);
    expect([r.activity.state, r.activity.startedAt]).toEqual(['full', now]);
    await expect(svc.signUp(id, 'late', { role: 'healer', label: 'L' })).rejects.toThrow(
      'This group has already started.',
    );
    expect(await storage.dueJobs(FAR)).toMatchObject([
      { type: 'finish', dueAt: new Date('2026-11-14T15:00:00Z') },
    ]);
  });

  it('needs at least 2 players', async () => {
    await expect(svc.startNow(await dungeon(0), starter)).rejects.toThrow(
      'You need at least 2 players to start.',
    );
    expect((await svc.startNow(await dungeon(1), starter)).activity.state).toBe('full');
  });

  it('is for the starter or an officer, once, and not for events', async () => {
    const id = await dungeon(1);
    await expect(svc.startNow(id, { userId: 'd0', isOfficer: false })).rejects.toThrow(
      'Only the starter or an officer can do that.',
    );
    await svc.startNow(id, { userId: 'o1', isOfficer: true });
    await expect(svc.startNow(id, starter)).rejects.toThrow('This group has already started.');
    const event = await svc.create({
      guildId: 'g1',
      kind: 'event',
      title: 'Fishing',
      starter: { userId: 'u1', label: 'S' },
      time: { type: 'asap' },
      slots: { participant: 5 },
      reminderOffsetsMin: [],
    });
    await expect(svc.startNow(event.activity.id, starter)).rejects.toThrow(
      'Events cannot be started early.',
    );
  });

  it('stays started when a member leaves', async () => {
    const id = await dungeon(2);
    await svc.startNow(id, starter);
    const r = await svc.leave(id, 'd0');
    expect(r.activity.state).toBe('full');
    expect(r.signups.map((s) => s.userId)).toEqual(['u1', 'd1']);
  });
});

describe('joined effect', () => {
  it('names the member who took a spot, not one who is waitlisted', async () => {
    const id = await dungeon(0);
    expect((await svc.signUp(id, 'h', { role: 'healer', label: 'H' })).effects).toEqual([
      { type: 'joined', userId: 'h' },
    ]);
    expect((await svc.signUp(id, 't2', { role: 'tank', label: 'T' })).effects).toEqual([]);
  });
});
