import { describe, expect, it } from 'vitest';
import type { Activity } from '../../src/core/types.js';
import { UserError } from '../../src/core/types.js';
import { messageIdFromLink, postLink } from '../../src/modules/shared-options.js';

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
