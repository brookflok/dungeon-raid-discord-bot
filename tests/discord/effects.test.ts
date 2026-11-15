import type { Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ActivityService } from '../../src/core/activities.js';
import { ConfigService } from '../../src/core/config.js';
import type { Signup, SignupStatus } from '../../src/core/types.js';
import { createPublisher, mentionChunks, recipients } from '../../src/discord/effects.js';
import { MemoryStorage } from '../../src/storage/memory.js';

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

describe('publisher when the thread cannot be started', () => {
  /** A post m1 in channel c1 whose thread cannot be started; `existing` is a thread already on it. */
  async function publishFilled(existing: boolean) {
    const sent: { to: string; payload: Record<string, unknown> }[] = [];
    const thread = {
      id: 'm1',
      isThread: () => true,
      isSendable: () => true,
      send: async (payload: Record<string, unknown>) => void sent.push({ to: 'thread', payload }),
    };
    const post = {
      id: 'm1',
      url: 'https://discord.com/channels/g1/c1/m1',
      startThread: () => Promise.reject(new Error('Missing Permissions')),
    };
    const channel = {
      isTextBased: () => true,
      isSendable: () => true,
      messages: { edit: async () => post },
      send: async (payload: Record<string, unknown>) => void sent.push({ to: 'channel', payload }),
    };
    const client = {
      channels: {
        fetch: async (id: string) => {
          if (id === 'c1') return channel;
          if (id === 'm1' && existing) return thread;
          throw new Error('Unknown Channel');
        },
      },
      users: { send: async () => undefined },
    } as unknown as Client;

    const storage = new MemoryStorage();
    const clock = { now: () => new Date('2026-11-14T12:00:00Z') };
    const activities = new ActivityService({ storage, clock });
    const { activity } = await activities.create({
      guildId: 'g1',
      kind: 'dungeon',
      title: 'SM',
      starter: { userId: 'u1', label: 'S' },
      starterRole: 'tank',
      time: { type: 'asap' },
      slots: { tank: 1, healer: 1 },
      reminderOffsetsMin: [],
    });
    await activities.setPost(activity.id, { channelId: 'c1', messageId: 'm1' });
    const filled = await activities.signUp(activity.id, 'u2', { role: 'healer', label: 'H' });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await createPublisher(client, activities, new ConfigService(storage))(filled);
    errors.mockRestore();
    const mentioned = sent.flatMap((s) => (s.payload.allowedMentions as { users: string[] }).users);
    return { sent, mentioned, stored: (await activities.get(activity.id))!.activity };
  }

  it('uses the thread that already exists on the post and stores it', async () => {
    const { sent, mentioned, stored } = await publishFilled(true);
    expect(sent.map((s) => s.to)).toEqual(['thread']);
    expect(sent[0]?.payload.embeds).toEqual([
      { description: '✅ The group is full — time to go!', color: 0x22c55e },
    ]);
    expect(mentioned).toEqual(['u1', 'u2']);
    expect(stored.threadId).toBe('m1');
  });

  it('with no thread at all, mentions the members in replies to the post', async () => {
    const { sent, mentioned, stored } = await publishFilled(false);
    expect(sent.map((s) => s.to)).toEqual(['channel']);
    expect(sent.map((s) => s.payload.reply)).toEqual([{ messageReference: 'm1' }]);
    expect(mentioned).toEqual(['u1', 'u2']);
    expect(stored.threadId).toBeUndefined();
  });
});
