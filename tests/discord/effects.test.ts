import { describe, expect, it } from 'vitest';
import type { Signup, SignupStatus } from '../../src/core/types.js';
import { mentionChunks, recipients } from '../../src/discord/effects.js';

const signup = (userId: string, status: SignupStatus): Signup => ({
  activityId: 'a1',
  userId,
  status,
  label: userId,
  createdAt: new Date('2026-11-14T12:00:00Z'),
});
const signups = [
  signup('confirmed', 'confirmed'),
  signup('waiting', 'waitlist'),
  signup('maybe', 'tentative'),
  signup('away', 'absent'),
];

describe('recipients', () => {
  it('tells a cancellation to confirmed, waitlisted and tentative members', () => {
    expect(recipients({ type: 'cancelled' }, signups)).toEqual(['confirmed', 'waiting', 'maybe']);
  });

  it('tells a time change to confirmed, waitlisted and tentative members', () => {
    expect(recipients({ type: 'timeChanged' }, signups)).toEqual(['confirmed', 'waiting', 'maybe']);
  });

  it('tells filled and refilled to confirmed and tentative members', () => {
    expect(recipients({ type: 'filled' }, signups)).toEqual(['confirmed', 'maybe']);
    expect(recipients({ type: 'refilled' }, signups)).toEqual(['confirmed', 'maybe']);
  });

  it('tells a reminder to confirmed and tentative members', () => {
    expect(recipients({ type: 'reminder', minutesBefore: 15 }, signups)).toEqual([
      'confirmed',
      'maybe',
    ]);
  });

  it('tells promoted and starterChanged to that one member', () => {
    expect(recipients({ type: 'promoted', userId: 'waiting' }, signups)).toEqual(['waiting']);
    expect(recipients({ type: 'starterChanged', userId: 'maybe' }, signups)).toEqual(['maybe']);
  });
});

describe('mentionChunks', () => {
  // 20-digit ids: the longest a Discord snowflake gets.
  const ids = (count: number) =>
    Array.from({ length: count }, (_, n) => String(10n ** 19n + BigInt(n)));

  it('splits 200 ids into 3 messages of at most 80 ids and 2000 characters', () => {
    const all = ids(200);
    const chunks = mentionChunks(all);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      expect(c.allowedMentions.users.length).toBeLessThanOrEqual(80);
      expect(c.content.length).toBeLessThanOrEqual(2000);
    }
    expect(chunks.flatMap((c) => c.allowedMentions.users)).toEqual(all);
    const text = chunks.map((c) => c.content).join(' ');
    for (const id of all) expect(text.split(`<@${id}>`)).toHaveLength(2);
  });

  it('keeps 5 ids in one message', () => {
    const chunks = mentionChunks(ids(5));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.allowedMentions.users).toEqual(ids(5));
  });
});
