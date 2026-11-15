import {
  ButtonStyle,
  escapeMarkdown,
  messageLink,
  type APIEmbed,
  type Client,
  type Message,
  type SendableChannels,
} from 'discord.js';
import type { ActivityResult, ActivityService, ActivityView, Effect } from '../core/activities.js';
import type { ConfigService } from '../core/config.js';
import type { Activity, Signup, SignupStatus, TimeSpec } from '../core/types.js';
import { log } from '../log.js';
import { COLOR, button, linkButton, notice, row } from './notice.js';
import { OUTCOME, finishId, renderActivity, renderLog, timeText } from './render.js';

interface ThreadMessage {
  content: string;
  embeds?: APIEmbed[];
  components?: ReturnType<typeof row>[];
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

/** The notice as a box on the first message; the recipients are mentioned as text in chunks. */
function threadMessages({ activity, signups }: ActivityView, effects: Effect[]): ThreadMessage[] {
  const lines: string[] = [];
  const users = new Set<string>();
  for (const e of effects) {
    const text = effectText(e, activity.time);
    if (!text) continue;
    lines.push(text);
    for (const id of recipients(e, signups)) users.add(id);
  }
  const chunks = mentionChunks([...users]);
  if (!chunks[0]) return [];
  const bad = effects.some((e) => e.type === 'cancelled');
  chunks[0].embeds = [{ description: lines.join('\n'), color: bad ? COLOR.closed : COLOR.ok }];
  if (effects.some((e) => e.type === 'filled' || e.type === 'refilled')) {
    // For the starter and officers; the finish module refuses everyone else.
    chunks[0].components = [
      row(button(finishId(activity.id), 'Finish', ButtonStyle.Secondary, '🏁')),
    ];
  }
  return chunks;
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

  /**
   * The stored thread if it still exists, otherwise a new thread on the post, otherwise the thread
   * that already exists on the post; null when there is none. Each failed step is logged.
   */
  async function groupThread(view: ActivityView, post?: Message): Promise<SendableChannels | null> {
    const { activity } = view;
    if (activity.threadId) {
      const existing = await client.channels.fetch(activity.threadId).catch(() => null);
      if (existing?.isSendable()) return existing;
    }
    let thread: SendableChannels | null = null;
    if (post) {
      try {
        thread = await post.startThread({ name: activity.title.slice(0, 100) });
      } catch (err) {
        log.error('publish: start thread', { activityId: activity.id, err });
      }
    }
    if (!thread && activity.messageId) {
      // A message's thread has the message's id, e.g. one a simultaneous publish just started.
      try {
        const found = await client.channels.fetch(activity.messageId);
        if (found?.isThread()) thread = found;
      } catch (err) {
        log.error('publish: find thread', { activityId: activity.id, err });
      }
    }
    if (!thread) return null;
    try {
      await activities.setThread(activity.id, thread.id);
    } catch (err) {
      log.error('publish: store thread', { activityId: activity.id, err });
    }
    return thread;
  }

  /**
   * Moves a finished activity to the log channel: sends (or updates) the log entry, removes the
   * post and closes the thread. False when there is no log channel or the entry cannot be shown;
   * the post then stays where it is.
   */
  async function moveToLog(view: ActivityView): Promise<boolean> {
    const { activity } = view;
    try {
      const channelId = activity.logChannelId ?? (await config.get(activity.guildId)).channels.log;
      if (!channelId) return false;
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isSendable()) throw new Error(`channel ${channelId} is not sendable`);
      const entry = renderLog(view);
      if (activity.logMessageId) {
        await channel.messages.edit(activity.logMessageId, entry);
        return true;
      }
      const message = await channel.send(entry);
      await activities.setLog(activity.id, { channelId, messageId: message.id });
      await closePost(activity, message.url);
      return true;
    } catch (err) {
      log.error('publish: log', { activityId: activity.id, err });
      return false;
    }
  }

  /** Removes the moved activity's post and leaves a last note in its thread before closing it. */
  async function closePost(activity: Activity, logUrl: string): Promise<void> {
    try {
      if (activity.channelId && activity.messageId) {
        const channel = await client.channels.fetch(activity.channelId);
        if (channel?.isTextBased()) await channel.messages.delete(activity.messageId);
      }
    } catch (err) {
      log.error('publish: remove post', { activityId: activity.id, err });
    }
    try {
      if (!activity.threadId) return;
      const thread = await client.channels.fetch(activity.threadId).catch(() => null);
      if (!thread?.isThread()) return;
      const result = activity.outcome ? OUTCOME[activity.outcome].name : 'no result reported yet';
      await thread.send({
        ...notice(`This group is closed: ${result}.`, 'info', '🏁 Finished'),
        components: [row(linkButton(logUrl, 'Go to the log entry'))],
      });
      // Locking needs the Manage Threads permission; archiving alone still hides the thread.
      await thread.setLocked(true).catch(() => undefined);
      await thread.setArchived(true);
    } catch (err) {
      log.error('publish: close thread', { activityId: activity.id, err });
    }
  }

  return async (r) => {
    // Re-read so the post shows the latest stored state and the stored ids are current.
    let view: ActivityView = r;
    try {
      view = (await activities.get(r.activity.id)) ?? r;
    } catch (err) {
      log.error('publish: re-read', { activityId: r.activity.id, err });
    }
    const { activity, signups } = view;
    if (activity.state === 'finished' && (await moveToLog(view))) return;

    let post: Message | undefined;
    try {
      post = await showPost(view);
    } catch (err) {
      log.error('publish: post', { activityId: activity.id, err });
    }

    try {
      const messages = threadMessages(view, r.effects);
      if (messages.length > 0) {
        const thread = await groupThread(view, post);
        if (thread) {
          for (const m of messages) await thread.send(m);
        } else {
          // Without a thread the members are mentioned in replies to the post (spec 5.3 step 8).
          const { channelId, messageId } = activity;
          if (!channelId || !messageId) throw new Error('no thread and no post to reply to');
          const channel = await client.channels.fetch(channelId);
          if (!channel?.isSendable()) throw new Error(`channel ${channelId} is not sendable`);
          for (const m of messages) {
            await channel.send({ ...m, reply: { messageReference: messageId } });
          }
        }
      }
    } catch (err) {
      log.error('publish: mentions', { activityId: activity.id, err });
    }

    try {
      if (r.effects.some((e) => e.type === 'filled')) {
        const { guildId, channelId, messageId } = activity;
        const url =
          post?.url ?? (channelId && messageId && messageLink(channelId, messageId, guildId));
        if (!url) throw new Error('no post to link to');
        const message = {
          ...notice(
            `Your group **${escapeMarkdown(activity.title)}** is full.`,
            'ok',
            '✅ Group full',
          ),
          components: [row(linkButton(url, 'Go to post'))],
        };
        // A member who blocks direct messages still has the thread mention; not an error.
        await Promise.allSettled(
          signups
            .filter((s) => s.status === 'confirmed')
            .map((s) => client.users.send(s.userId, message)),
        );
      }
    } catch (err) {
      log.error('publish: direct messages', { activityId: activity.id, err });
    }
  };
}
