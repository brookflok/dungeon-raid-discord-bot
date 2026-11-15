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

describe('publisher for a finished activity', () => {
  async function setup(logChannel: boolean) {
    const calls: string[] = [];
    const logged: Record<string, unknown>[] = [];
    const thread = {
      isThread: () => true,
      isSendable: () => true,
      send: async () => void calls.push('thread note'),
      setLocked: async () => void calls.push('thread locked'),
      setArchived: async () => void calls.push('thread archived'),
    };
    const posts = {
      isTextBased: () => true,
      isSendable: () => true,
      messages: {
        edit: async () => (calls.push('post edited'), { id: 'm1', url: 'u' }),
        delete: async (id: string) => void calls.push(`post ${id} deleted`),
      },
    };
    const logs = {
      isSendable: () => true,
      send: async (payload: Record<string, unknown>) => {
        calls.push('log sent');
        logged.push(payload);
        return { id: 'l1', url: 'https://discord.com/channels/g1/log/l1' };
      },
      messages: {
        edit: async (id: string, payload: Record<string, unknown>) => {
          calls.push(`log ${id} edited`);
          logged.push(payload);
        },
      },
    };
    const client = {
      channels: {
        fetch: async (id: string) => ({ c1: posts, t1: thread, log: logs })[id] ?? null,
      },
      users: { send: async () => undefined },
    } as unknown as Client;

    const storage = new MemoryStorage();
    let now = new Date('2026-11-14T12:00:00Z');
    const activities = new ActivityService({ storage, clock: { now: () => now } });
    const config = new ConfigService(storage);
    if (logChannel) await config.update('g1', { channels: { dungeon: 'c1', log: 'log' } });
    const { activity } = await activities.create({
      guildId: 'g1',
      kind: 'dungeon',
      title: 'SM',
      starter: { userId: 'u1', label: 'S' },
      starterRole: 'tank',
      time: { type: 'at', at: new Date('2026-11-14T13:00:00Z') },
      slots: { tank: 1, healer: 1 },
      reminderOffsetsMin: [],
    });
    await activities.setPost(activity.id, { channelId: 'c1', messageId: 'm1' });
    await activities.setThread(activity.id, 't1');
    const publish = createPublisher(client, activities, config);
    const starter = { userId: 'u1', isOfficer: false };
    const title = () => (logged.at(-1)!.embeds as { title: string }[])[0]!.title;
    const stored = async () => (await activities.get(activity.id))!.activity;
    const autoFinish = async () => {
      now = new Date('2026-11-14T16:00:00Z');
      for (const job of await storage.dueJobs(now)) {
        const result = await activities.runJob(job);
        if (result) await publish(result);
      }
    };
    return { id: activity.id, activities, publish, starter, calls, title, stored, autoFinish };
  }

  it('moves a reported activity to the log, removes the post and closes the thread', async () => {
    const t = await setup(true);
    await t.publish(await t.activities.report(t.id, t.starter, 'completed', 'Clean run.'));
    expect(t.calls).toEqual([
      'log sent',
      'post m1 deleted',
      'thread note',
      'thread locked',
      'thread archived',
    ]);
    expect(t.title()).toBe('✅ SM — Completed');
    const stored = await t.stored();
    expect(stored.logMessageId).toBe('l1');
    expect(stored.messageId).toBeUndefined();
  });

  it('moves an unreported activity after 3 hours and updates the entry on a later report', async () => {
    const t = await setup(true);
    await t.autoFinish();
    expect(t.calls.slice(0, 2)).toEqual(['log sent', 'post m1 deleted']);
    expect(t.title()).toBe('❔ SM — No result reported');
    await t.publish(await t.activities.report(t.id, t.starter, 'failed'));
    expect(t.calls.at(-1)).toBe('log l1 edited');
    expect(t.title()).toBe('❌ SM — Failed');
    expect(t.calls.filter((c) => c === 'log sent')).toHaveLength(1);
  });

  it('without a log channel keeps the post and shows the result on it', async () => {
    const t = await setup(false);
    await t.publish(await t.activities.report(t.id, t.starter, 'completed'));
    expect(t.calls).toEqual(['post edited']);
    expect((await t.stored()).messageId).toBe('m1');
  });
});
