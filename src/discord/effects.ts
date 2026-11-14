import type { Client, Message, SendableChannels } from 'discord.js';
import type { ActivityResult, ActivityService, ActivityView, Effect } from '../core/activities.js';
import type { ConfigService } from '../core/config.js';
import type { TimeSpec } from '../core/types.js';
import { renderActivity, timeText } from './render.js';

/** The line for an effect told to the whole group; undefined for the others. */
function groupText(e: Effect, time: TimeSpec): string | undefined {
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
  }
}

/** One thread message for the result's effects, mentioning only the members concerned. */
function threadNote({ activity, signups }: ActivityView, effects: Effect[]) {
  const lines: string[] = [];
  const users = new Set<string>();
  let tellGroup = false;
  for (const e of effects) {
    if (e.type === 'promoted' || e.type === 'starterChanged') {
      lines.push(
        e.type === 'promoted'
          ? `⬆️ <@${e.userId}> moved up from the waitlist and is now in the group.`
          : `👑 <@${e.userId}> is now the starter of this group.`,
      );
      users.add(e.userId);
    } else {
      const text = groupText(e, activity.time);
      if (text) {
        lines.push(text);
        tellGroup = true;
      }
    }
  }
  const group = signups
    .filter((s) => s.status === 'confirmed' || s.status === 'tentative')
    .map((s) => s.userId);
  if (tellGroup && group.length > 0) {
    lines.push(group.map((id) => `<@${id}>`).join(' '));
    group.forEach((id) => users.add(id));
  }
  if (users.size === 0) return null;
  return { content: lines.join('\n'), allowedMentions: { users: [...users] } };
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
    const view = (await activities.get(r.activity.id)) ?? r;
    const { activity, signups } = view;

    let post: Message | undefined;
    try {
      post = await showPost(view);
    } catch (err) {
      console.error('publish: post', activity.id, err);
    }

    try {
      const note = threadNote(view, r.effects);
      if (note) await (await groupThread(view, post)).send(note);
    } catch (err) {
      console.error('publish: thread', activity.id, err);
    }

    try {
      if (r.effects.some((e) => e.type === 'filled')) {
        if (!post) throw new Error('no post to link to');
        const content = `✅ Your group "${activity.title}" is full: ${post.url}`;
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
