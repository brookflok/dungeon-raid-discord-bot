import {
  StringSelectMenuBuilder,
  type APISelectMenuOption,
  type BaseInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
import type { ActivityResult, Actor } from '../core/activities.js';
import { characterLabel } from '../core/profiles.js';
import type { TemplateService } from '../core/templates.js';
import { parseTime } from '../core/time.js';
import {
  UserError,
  type Activity,
  type GuildConfig,
  type Kind,
  type TimeSpec,
} from '../core/types.js';
import { notice } from '../discord/notice.js';
import type { Services } from '../discord/registry.js';

const WHEN = 'today 20:30, tomorrow 19:00, 2026-11-20 19:00, asap or flexible';
const LINK = /\/channels\/\d+\/\d+\/(\d+)\/?$/;

export const ROLE_OPTIONS: APISelectMenuOption[] = [
  { label: 'Tank', value: 'tank', emoji: { name: '🛡' } },
  { label: 'Healer', value: 'healer', emoji: { name: '💚' } },
  { label: 'DPS', value: 'dps', emoji: { name: '🗡' } },
];

/** A dropdown for a form. */
export const select = (
  id: string,
  options: APISelectMenuOption[],
  required = true,
): StringSelectMenuBuilder =>
  new StringSelectMenuBuilder().setCustomId(id).setRequired(required).addOptions(options);

/** The enabled templates of that kind as dropdown options; a dropdown holds at most 25. */
export async function templateOptions(
  s: Services,
  guildId: string,
  kind: 'dungeon' | 'raid',
): Promise<APISelectMenuOption[]> {
  const listed = await s.templates.list(guildId, kind);
  if (listed.length === 0) {
    throw new UserError(`There are no ${kind}s yet. An officer can add one with /template add.`);
  }
  return listed.slice(0, 25).map((t) => ({ label: t.name.slice(0, 100), value: t.id }));
}

export const whenOption = (required: boolean) => (o: SlashCommandStringOption) =>
  o
    .setName('when')
    .setDescription(required ? WHEN : `${WHEN} (default asap)`)
    .setRequired(required);

const postOption = (o: SlashCommandStringOption) =>
  o
    .setName('post')
    .setDescription('Link to the post (Copy Message Link); default: your most recent');

export const cancelSubcommand = (noun: string) => (c: SlashCommandSubcommandBuilder) =>
  c.setName('cancel').setDescription(`Cancel your ${noun}`).addStringOption(postOption);

export const timeSubcommand = (noun: string) => (c: SlashCommandSubcommandBuilder) =>
  c
    .setName('time')
    .setDescription(`Change the time of your ${noun}`)
    .addStringOption(whenOption(true))
    .addStringOption(postOption);

export function resolveTimeOption(when: string | null, now: Date, timezone: string): TimeSpec {
  if (when === null || when.trim().toLowerCase() === 'asap') return { type: 'asap' };
  if (when.trim().toLowerCase() === 'flexible') return { type: 'flexible' };
  const at = parseTime(when, now, timezone);
  if (!at) {
    throw new UserError(
      'I could not read that time. Try "today 20:30", "tomorrow 19:00", "2026-11-20 19:00", "asap" or "flexible".',
    );
  }
  return { type: 'at', at };
}

/** The message id from the optional `post` option. */
export function messageIdFromLink(link: string | null): string | undefined {
  if (link === null) return undefined;
  const m = LINK.exec(link.trim());
  if (!m) throw new UserError('That is not a message link. Use "Copy Message Link" on the post.');
  return m[1];
}

export function postLink(a: Activity): string {
  if (!a.channelId || !a.messageId) throw new Error(`activity ${a.id} has no post`);
  return `https://discord.com/channels/${a.guildId}/${a.channelId}/${a.messageId}`;
}

/**
 * Publishes a new activity and returns the link to its post. When the post could not be sent,
 * the activity is cancelled (not published again) so none is left without a post.
 */
export async function publishNew(s: Services, result: ActivityResult): Promise<string> {
  await s.publish(result);
  const { activity } = (await s.activities.get(result.activity.id))!;
  if (!activity.messageId) {
    // The caller just started it, and the starter may always cancel.
    await s.activities.cancel(activity.id, { userId: activity.starterId, isOfficer: false });
    throw new UserError(
      'I could not post in the channel. An officer should check that I can send messages there.',
    );
  }
  return postLink(activity);
}

/** The template picked from the dropdown; anything else or another kind is rejected. */
export async function resolveTemplateOption(
  s: Services,
  guildId: string,
  kind: 'dungeon' | 'raid',
  id: string,
): ReturnType<TemplateService['resolve']> {
  const listed = await s.templates.list(guildId, kind);
  if (!listed.some((t) => t.id === id)) {
    throw new UserError(`Pick a ${kind} from the list.`);
  }
  return s.templates.resolve(id);
}

/** `cancel` and `time`: the linked post, or the caller's most recent open one of that kind. */
export async function manageTarget(
  i: ChatInputCommandInteraction,
  s: Services,
  kind: Kind,
  actor: Actor,
): Promise<void> {
  const guildId = i.guildId!; // guild-only commands
  const messageId = messageIdFromLink(i.options.getString('post'));
  const target = await s.activities.findTarget(guildId, kind, actor.userId, messageId);
  if (i.options.getSubcommand() === 'cancel') {
    await s.publish(await s.activities.cancel(target.id, actor));
    await i.editReply(notice(`The ${kind === 'dungeon' ? 'group' : kind} is cancelled.`, 'ok'));
  } else {
    const { timezone } = await s.config.get(guildId);
    const time = resolveTimeOption(i.options.getString('when', true), s.clock.now(), timezone);
    await s.publish(await s.activities.setTime(target.id, actor, time));
    await i.editReply(notice('The new time is set.', 'ok'));
  }
}

/** Checked before creating an activity, so a missing channel never leaves one without a post. */
export function requireChannel(config: GuildConfig, kind: Kind): void {
  if (!config.channels[kind]) {
    throw new UserError('An officer needs to set the channel first with /config channels.');
  }
}

/** The member's main character (first in ProfileService.list), else their server display name. */
export async function starterLabel(i: BaseInteraction, s: Services): Promise<string> {
  const { characters } = await s.profiles.list(i.user.id);
  if (characters[0]) return characterLabel(characters[0]);
  return i.inCachedGuild() ? i.member.displayName : i.user.displayName;
}
