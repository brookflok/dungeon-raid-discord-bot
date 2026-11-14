import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityService, type SignupChoice } from '../../src/core/activities.js';
import type { Clock } from '../../src/core/ports.js';
import { UserError, type Slots } from '../../src/core/types.js';
import { MemoryStorage } from '../../src/storage/memory.js';

class FakeClock implements Clock {
  constructor(private current = new Date('2026-11-14T12:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms = 1000): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const tank: SignupChoice = { role: 'tank', label: 'T' };
const healer: SignupChoice = { role: 'healer', label: 'H' };
const dps: SignupChoice = { role: 'dps', label: 'D' };

let storage: MemoryStorage;
let clock: FakeClock;
let svc: ActivityService;

beforeEach(() => {
  storage = new MemoryStorage();
  clock = new FakeClock();
  svc = new ActivityService({ storage, clock });
});

async function join(id: string, userId: string, choice: SignupChoice) {
  clock.advance();
  return svc.signUp(id, userId, choice);
}

async function dungeon() {
  const r = await svc.create({
    guildId: 'g1',
    kind: 'dungeon',
    title: 'Scarlet Monastery',
    starter: { userId: 'u1', label: 'Starter' },
    starterRole: 'tank',
    time: { type: 'asap' },
    slots: { tank: 1, healer: 1, dps: 3 },
    reminderOffsetsMin: [15],
  });
  return r.activity.id;
}

async function fillDungeon(id: string) {
  await join(id, 'u2', healer);
  await join(id, 'u3', dps);
  await join(id, 'u4', dps);
  return join(id, 'u5', dps);
}

function other(kind: 'raid' | 'event', time: 'at' | 'asap', slots: Slots, at?: Date) {
  return svc.create({
    guildId: 'g1',
    kind,
    title: 'Thing',
    starter: { userId: 'u1', label: 'Starter' },
    time:
      time === 'at' ? { type: 'at', at: at ?? new Date('2026-11-20T18:00:00Z') } : { type: 'asap' },
    slots,
    reminderOffsetsMin: [60],
  });
}

describe('ActivityService signups', () => {
  it('starter occupies their role', async () => {
    const id = await dungeon();
    const view = (await svc.get(id))!;
    expect(view.activity.starterId).toBe('u1');
    expect(view.signups).toMatchObject([
      { userId: 'u1', role: 'tank', status: 'confirmed', label: 'Starter' },
    ]);
  });

  it('filling every slot emits filled once', async () => {
    const id = await dungeon();
    const r = await fillDungeon(id);
    expect(r.activity.state).toBe('full');
    expect(r.activity.filledAt).toBeDefined();
    expect(r.effects).toContainEqual({ type: 'filled' });
  });

  it('a full role waitlists', async () => {
    const id = await dungeon();
    const r = await join(id, 'u6', tank);
    expect(r.signups.find((s) => s.userId === 'u6')?.status).toBe('waitlist');
    expect(r.effects).toEqual([]);
  });

  it('leaving promotes the first waitlisted member of that role', async () => {
    const id = await dungeon();
    await join(id, 'u6', tank);
    await join(id, 'u7', tank);
    const r = await svc.leave(id, 'u1');
    expect(r.effects).toContainEqual({ type: 'promoted', userId: 'u6' });
    expect(r.signups.find((s) => s.userId === 'u6')?.status).toBe('confirmed');
    expect(r.signups.find((s) => s.userId === 'u7')?.status).toBe('waitlist');
  });

  it('leaving a full group reopens it; refilling emits refilled, not filled', async () => {
    const id = await dungeon();
    await fillDungeon(id);
    const left = await svc.leave(id, 'u5');
    expect(left.activity.state).toBe('open');
    const again = await join(id, 'u8', dps);
    expect(again.activity.state).toBe('full');
    expect(again.effects).toContainEqual({ type: 'refilled' });
    expect(again.effects).not.toContainEqual({ type: 'filled' });
  });

  it('switching role moves the member and frees the old slot', async () => {
    const id = await dungeon();
    await join(id, 'u2', dps);
    await join(id, 'u3', dps);
    const r = await join(id, 'u2', healer);
    expect(r.signups.filter((s) => s.userId === 'u2')).toHaveLength(1);
    expect(r.signups.filter((s) => s.role === 'dps' && s.status === 'confirmed')).toHaveLength(1);
    expect(r.signups.find((s) => s.userId === 'u2')?.role).toBe('healer');
  });

  it('switching away from a full role promotes the waitlist', async () => {
    const id = await dungeon();
    await join(id, 'u6', tank);
    const r = await join(id, 'u1', healer);
    expect(r.effects).toContainEqual({ type: 'promoted', userId: 'u6' });
  });

  it('starter leaving hands over to the earliest member', async () => {
    const id = await dungeon();
    await join(id, 'u2', healer);
    await join(id, 'u3', dps);
    const r = await svc.leave(id, 'u1');
    expect(r.activity.starterId).toBe('u2');
    expect(r.effects).toContainEqual({ type: 'starterChanged', userId: 'u2' });
  });

  it('last member leaving closes the dungeon', async () => {
    const id = await dungeon();
    const r = await svc.leave(id, 'u1');
    expect(r.activity.state).toBe('expired');
    expect(r.effects).toContainEqual({ type: 'closed', reason: 'empty' });
  });

  it('leaving without a signup is rejected', async () => {
    const id = await dungeon();
    await expect(svc.leave(id, 'nobody')).rejects.toThrow('You are not signed up.');
  });

  it('raid: tentative and absent do not use slots', async () => {
    const { activity } = await other('raid', 'at', { tank: 1, dps: 1 });
    await join(activity.id, 'u2', { status: 'tentative', label: 'A' });
    const r = await join(activity.id, 'u3', { status: 'absent', label: 'B' });
    expect(r.signups.map((s) => [s.status, s.role])).toEqual([
      ['tentative', undefined],
      ['absent', undefined],
    ]);
    expect(r.activity.state).toBe('open');
  });

  it('tentative is only for raids', async () => {
    const id = await dungeon();
    await expect(join(id, 'u2', { status: 'tentative', label: 'A' })).rejects.toThrow(UserError);
  });

  it('a role outside the slots is rejected', async () => {
    const { activity } = await other('event', 'asap', { participant: null });
    await expect(join(activity.id, 'u2', tank)).rejects.toThrow(UserError);
  });

  it('a dungeon starter cannot take a role with no slots', async () => {
    await expect(
      svc.create({
        guildId: 'g1',
        kind: 'dungeon',
        title: 'Pair',
        starter: { userId: 'u1', label: 'Starter' },
        starterRole: 'healer',
        time: { type: 'asap' },
        slots: { tank: 1, healer: 0, dps: 1 },
        reminderOffsetsMin: [15],
      }),
    ).rejects.toThrow('That role is not part of this group.');
  });

  it('raid without a time is rejected', async () => {
    await expect(other('raid', 'asap', { tank: 1 })).rejects.toThrow(UserError);
  });

  it('event with unlimited participants never becomes full', async () => {
    const { activity } = await other('event', 'asap', { participant: null });
    for (let i = 0; i < 50; i++)
      await join(activity.id, `p${i}`, { role: 'participant', label: 'P' });
    const view = (await svc.get(activity.id))!;
    expect(view.activity.state).toBe('open');
    expect(view.signups.every((s) => s.status === 'confirmed')).toBe(true);
  });

  it('capped event waitlists at the cap', async () => {
    const { activity } = await other('event', 'asap', { participant: 2 });
    const p: SignupChoice = { role: 'participant', label: 'P' };
    await join(activity.id, 'p1', p);
    await join(activity.id, 'p2', p);
    const r = await join(activity.id, 'p3', p);
    expect(r.signups.map((s) => s.status)).toEqual(['confirmed', 'confirmed', 'waitlist']);
    expect(r.activity.state).toBe('full');
  });

  it('time in the past is rejected', async () => {
    await expect(
      other('event', 'at', { participant: null }, new Date('2026-11-14T11:00:00Z')),
    ).rejects.toThrow(/in the past/);
  });

  it('signing up to a closed activity is rejected', async () => {
    const id = await dungeon();
    const a = (await storage.getActivity(id))!;
    await storage.updateActivity({ ...a, state: 'cancelled' });
    await expect(svc.signUp(id, 'u2', healer)).rejects.toThrow('This group is closed.');
  });

  it('two simultaneous signups for the last slot', async () => {
    const id = await dungeon();
    await Promise.all([svc.signUp(id, 'u8', healer), svc.signUp(id, 'u9', healer)]);
    const statuses = (await svc.get(id))!.signups
      .filter((s) => s.role === 'healer')
      .map((s) => s.status)
      .sort();
    expect(statuses).toEqual(['confirmed', 'waitlist']);
  });

  it('choosing the same role with a different label updates the label only', async () => {
    const id = await dungeon();
    await join(id, 'u2', healer);
    const before = (await svc.get(id))!.signups.find((s) => s.userId === 'u2')!;
    const r = await join(id, 'u2', { role: 'healer', label: 'Alt' });
    const after = r.signups.find((s) => s.userId === 'u2')!;
    expect(after).toEqual({ ...before, label: 'Alt' });
    expect(r.signups).toHaveLength(2);
  });

  it('leaving a closed activity is rejected and changes nothing', async () => {
    const id = await dungeon();
    const a = (await storage.getActivity(id))!;
    await storage.updateActivity({ ...a, state: 'cancelled' });
    await expect(svc.leave(id, 'u1')).rejects.toThrow('This group is closed.');
    expect((await svc.get(id))!.signups).toHaveLength(1);
  });

  it('stores post and thread ids', async () => {
    const id = await dungeon();
    await svc.setPost(id, { channelId: 'c1', messageId: 'm1' });
    await svc.setThread(id, 't1');
    expect((await svc.get(id))!.activity).toMatchObject({
      channelId: 'c1',
      messageId: 'm1',
      threadId: 't1',
    });
  });
});
