import { messageLink, type Client, type Message, type SendableChannels } from 'discord.js';
import type { ActivityResult, ActivityService, ActivityView, Effect } from '../core/activities.js';
import type { ConfigService } from '../core/config.js';
import type { Signup, SignupStatus, TimeSpec } from '../core/types.js';
import { renderActivity, timeText } from './render.js';

interface ThreadMessage {
  content: string;
  allowedMentions: { users: string[] };
}

/** Who is mentioned in the thread for an effect. */
export function recipients(e: Effect, signups: Signup[]): string[] {
  const withStatus = (...statuses: SignupStatus[]): string[] =>
    signups.filter((s) => statuses.includes(s.status)).map((s) => s.userId);
  switch (e.type) {
    case 'cancelled':
    case 'timeChanged':
      return withStatus('confirmed', 'waitlist', 'tentative');
    case 'filled':
    case 'refilled':
    case 'reminder':
      return withStatus('confirmed', 'tentative'); // tentative exists only in raids
    case 'promoted':
    case 'starterChanged':
      return [e.userId];
    case 'closed':
      return [];
  }
}

/** Mentions split into messages of at most 80 ids (Discord allows 100 ids and 2000 characters). */
export function mentionChunks(userIds: string[]): ThreadMessage[] {
  const chunks: ThreadMessage[] = [];
  for (let n = 0; n < userIds.length; n += 80) {
    const users = userIds.slice(n, n + 80);
    chunks.push({ content: users.map((id) => `<@${id}>`).join(' '), allowedMentions: { users } });
  }
  return chunks;
}

/** The thread line for an effect; promoted and starterChanged name their member inline. */
function effectText(e: Effect, time: TimeSpec): string | undefined {
  switch (e.type) {
    case 'filled':
      if (time.type === 'at') return `✅ The group is full! Starts ${timeText(time)}`;
      return time.type === 'asap'
        ? '✅ The group is full — time to go!'
        : '✅ The group is full — agree on a time here.';
    case 'refilled':
      return '✅ The group is full again.';
    case 'timeChanged':
      return `🕐 New time: ${timeText(time)}`;
    case 'cancelled':
      return '🚫 This group was cancelled.';
    case 'reminder':
      return `⏰ Reminder: starts ${timeText(time)}`;
    case 'promoted':
      return `⬆️ <@${e.userId}> moved up from the waitlist and is now in the group.`;
    case 'starterChanged':
      return `👑 <@${e.userId}> is now the starter of this group.`;
  }
}

/** The text (pinging only members named in it), then the other recipients in mention chunks. */
function threadMessages({ activity, signups }: ActivityView, effects: Effect[]): ThreadMessage[] {
  const lines: string[] = [];
  const named = new Set<string>();
  const others = new Set<string>();
  for (const e of effects) {
    const text = effectText(e, activity.time);
    if (!text) continue;
    lines.push(text);
    const inline = e.type === 'promoted' || e.type === 'starterChanged';
    for (const id of recipients(e, signups)) (inline ? named : others).add(id);
  }
  named.forEach((id) => others.delete(id));
  if (named.size + others.size === 0) return [];
  return [
    { content: lines.join('\n'), allowedMentions: { users: [...named] } },
    ...mentionChunks([...others]),
  ];
}

export function createPublisher(
  client: Client,
  activities: ActivityService,
  config: ConfigService,
): (r: ActivityResult) => Promise<void> {
  /** Edits the post, or sends it to the kind's channel when the activity has none yet. */
  async function showPost(view: ActivityView): Promise<Message> {
    const { activity } = view;
    const payload = { ...renderActivity(view), allowedMentions: { parse: [] } };
    if (activity.channelId && activity.messageId) {
      const channel = await client.channels.fetch(activity.channelId);
      if (!channel?.isTextBased()) throw new Error(`channel ${activity.channelId} is not text`);
      return channel.messages.edit(activity.messageId, payload);
    }
    const channelId = (await config.get(activity.guildId)).channels[activity.kind];
    if (!channelId) throw new Error(`no ${activity.kind} channel configured`);
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error(`channel ${channelId} is not sendable`);
    const message = await channel.send(payload);
    await activities.setPost(activity.id, { channelId, messageId: message.id });
    return message;
  }

  /** The stored thread if it still exists, otherwise a new thread on the post. */
  async function groupThread(view: ActivityView, post?: Message): Promise<SendableChannels> {
    const { activity } = view;
    if (activity.threadId) {
      const existing = await client.channels.fetch(activity.threadId).catch(() => null);
      if (existing?.isSendable()) return existing;
    }
    if (!post) throw new Error('no post to start a thread on');
    const thread = await post.startThread({ name: activity.title.slice(0, 100) });
    await activities.setThread(activity.id, thread.id);
    return thread;
  }

  return async (r) => {
    // Re-read so the post shows the latest stored state and the stored ids are current.
    let view: ActivityView = r;
    try {
      view = (await activities.get(r.activity.id)) ?? r;
    } catch (err) {
      console.error('publish: re-read', r.activity.id, err);
    }
    const { activity, signups } = view;

    let post: Message | undefined;
    try {
      post = await showPost(view);
    } catch (err) {
      console.error('publish: post', activity.id, err);
    }

    try {
      const messages = threadMessages(view, r.effects);
      if (messages.length > 0) {
        const thread = await groupThread(view, post);
        for (const m of messages) await thread.send(m);
      }
    } catch (err) {
      console.error('publish: thread', activity.id, err);
    }

    try {
      if (r.effects.some((e) => e.type === 'filled')) {
        const { guildId, channelId, messageId } = activity;
        const url =
          post?.url ?? (channelId && messageId && messageLink(channelId, messageId, guildId));
        if (!url) throw new Error('no post to link to');
        const content = `✅ Your group "${activity.title}" is full: ${url}`;
        // A member who blocks direct messages still has the thread mention; not an error.
        await Promise.allSettled(
          signups
            .filter((s) => s.status === 'confirmed')
            .map((s) => client.users.send(s.userId, content)),
        );
      }
    } catch (err) {
      console.error('publish: direct messages', activity.id, err);
    }
  };
}
