import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityService, type ActivityResult } from '../../src/core/activities.js';
import type { Activity } from '../../src/core/types.js';
import { UserError } from '../../src/core/types.js';
import type { Services } from '../../src/discord/registry.js';
import { messageIdFromLink, postLink, publishNew } from '../../src/modules/shared-options.js';
import { MemoryStorage } from '../../src/storage/memory.js';

describe('messageIdFromLink', () => {
  it('returns undefined when no link was given', () => {
    expect(messageIdFromLink(null)).toBeUndefined();
  });

  it('reads the message id from a Discord message link', () => {
    expect(messageIdFromLink('https://discord.com/channels/111/222/333')).toBe('333');
    expect(messageIdFromLink(' https://ptb.discord.com/channels/111/222/444 ')).toBe('444');
  });

  it('rejects anything that is not a message link', () => {
    expect(() => messageIdFromLink('my raid')).toThrow(UserError);
    expect(() => messageIdFromLink('https://discord.com/channels/111/222')).toThrow(UserError);
  });
});

describe('postLink', () => {
  const activity = { id: 'a1', guildId: '111', channelId: '222', messageId: '333' } as Activity;

  it('links to the post', () => {
    expect(postLink(activity)).toBe('https://discord.com/channels/111/222/333');
  });

  it('throws when the activity has no post', () => {
    expect(() => postLink({ ...activity, messageId: undefined })).toThrow();
  });
});

describe('publishNew', () => {
  let activities: ActivityService;
  let published: string[];
  beforeEach(() => {
    activities = new ActivityService({
      storage: new MemoryStorage(),
      clock: { now: () => new Date('2026-11-14T12:00:00Z') },
    });
    published = [];
  });

  /** Services whose publisher records each call and stores a post only when `sends`. */
  const services = (sends: boolean) =>
    ({
      activities,
      publish: async (r: ActivityResult) => {
        published.push(r.activity.id);
        if (sends) await activities.setPost(r.activity.id, { channelId: 'c1', messageId: 'm1' });
      },
    }) as unknown as Services;

  const create = () =>
    activities.create({
      guildId: 'g1',
      kind: 'event',
      title: 'Party',
      starter: { userId: 'u1', label: 'U' },
      time: { type: 'asap' },
      slots: { participant: null },
      reminderOffsetsMin: [60],
    });

  it('publishes the activity and returns the link to its post', async () => {
    const result = await create();
    expect(await publishNew(services(true), result)).toBe('https://discord.com/channels/g1/c1/m1');
    expect(published).toEqual([result.activity.id]);
  });

  it('cancels the activity without publishing again when the post could not be sent', async () => {
    const result = await create();
    const err = await publishNew(services(false), result).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as UserError).message).toBe(
      'I could not post in the channel. An officer should check that I can send messages there.',
    );
    expect((await activities.get(result.activity.id))!.activity.state).toBe('cancelled');
    expect(published).toEqual([result.activity.id]);
  });
});
