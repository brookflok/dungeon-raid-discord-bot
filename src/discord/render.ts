import {
  ButtonStyle,
  ComponentType,
  escapeMarkdown,
  type APIEmbed,
  type ActionRowData,
  type InteractionButtonComponentData,
} from 'discord.js';
import type { ActivityView } from '../core/activities.js';
import type {
  Activity,
  ActivityState,
  Kind,
  Role,
  Signup,
  SignupStatus,
  TimeSpec,
} from '../core/types.js';
import { COLOR } from './notice.js';

const ROLES: { role: Role; emoji: string; name: string; button: string }[] = [
  { role: 'tank', emoji: '🛡', name: 'Tank', button: 'Tank' },
  { role: 'healer', emoji: '💚', name: 'Healer', button: 'Healer' },
  { role: 'dps', emoji: '🗡', name: 'DPS', button: 'DPS' },
  { role: 'participant', emoji: '👥', name: 'Coming', button: 'Join' },
];
const KIND: Record<Kind, { emoji: string; name: string; color: number }> = {
  dungeon: { emoji: '⚔️', name: 'Dungeon group', color: 0x3b82f6 },
  raid: { emoji: '🐉', name: 'Raid', color: 0xa855f7 },
  event: { emoji: '📅', name: 'Event', color: 0x22c55e },
};
const STATUS: Partial<Record<ActivityState, string>> = {
  finished: '✅ Finished',
  cancelled: '🚫 Cancelled',
  expired: '⌛ Expired',
};
const MAX_LENGTH = 4096; // an embed description
const BAR = 12;

export function discordTime(d: Date): string {
  const unix = Math.floor(d.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

export function timeText(time: TimeSpec): string {
  if (time.type === 'at') return discordTime(time.at);
  return time.type === 'asap' ? 'As soon as possible' : 'Flexible — time to be agreed';
}

/** Member text: no markdown, links or headings; a zero-width space after @ so nothing mentions. */
const escape = (text: string): string =>
  escapeMarkdown(text, { maskedLink: true, heading: true }).replace(/@/g, '@​');

/** One member per line, at most `max` of them, then "… and N more". */
function members(labels: string[], max: number, empty: string): string[] {
  if (labels.length === 0) return [empty];
  const lines = labels.slice(0, max).map((label) => `　${label}`);
  const rest = labels.length - Math.min(max, labels.length);
  if (rest > 0) lines.push(`　… and ${rest} more`);
  return lines;
}

/** "▰▰▰▱▱ 3/5 · needs Healer, DPS" for capped groups, a head count for unlimited ones. */
function progress(activity: Activity, signups: Signup[]): string {
  const confirmed = signups.filter((s) => s.status === 'confirmed');
  const roles = ROLES.filter((r) => activity.slots[r.role] !== undefined);
  if (roles.some((r) => activity.slots[r.role] === null))
    return `👥 **${confirmed.length}** coming`;
  const total = roles.reduce((sum, r) => sum + (activity.slots[r.role] ?? 0), 0);
  const filled = Math.min(BAR, Math.round((confirmed.length / Math.max(total, 1)) * BAR));
  const bar = '▰'.repeat(filled) + '▱'.repeat(BAR - filled);
  const missing = roles
    .filter(
      (r) => confirmed.filter((s) => s.role === r.role).length < (activity.slots[r.role] ?? 0),
    )
    .map((r) => (r.role === 'participant' ? 'people' : r.name));
  const state = missing.length > 0 ? `needs ${missing.join(', ')}` : 'full';
  return `${bar} **${confirmed.length}/${total}** · ${state}`;
}

/** Builds the card text from already escaped labels, showing at most `max` labels per list. */
function text(activity: Activity, signups: Signup[], max: number): string {
  const labels = (keep: (s: Signup) => boolean): string[] =>
    signups.filter(keep).map((s) => s.label);
  const lines = [`🕐 ${timeText(activity.time)}`, `👤 Started by <@${activity.starterId}>`];
  lines.push(progress(activity, signups));
  if (activity.description) lines.push('', escape(activity.description));
  for (const r of ROLES) {
    const cap = activity.slots[r.role];
    if (cap === undefined) continue;
    const names = labels((s) => s.role === r.role && s.status === 'confirmed');
    const open = cap === null || names.length < cap ? '　*open*' : '　—';
    lines.push('', `${r.emoji} **${r.name.toUpperCase()}** ${names.length}/${cap ?? '∞'}`);
    lines.push(...members(names, max, open));
  }
  const section = (emoji: string, name: string, status: SignupStatus): void => {
    const names = labels((s) => s.status === status);
    if (names.length === 0) return;
    lines.push('', `${emoji} **${name}** ${names.length}`, ...members(names, max, ''));
  };
  section('⏳', 'WAITLIST', 'waitlist');
  section('❔', 'TENTATIVE', 'tentative');
  section('❌', "CAN'T COME", 'absent');
  return lines.join('\n');
}

function footer(activity: Activity): string {
  const offsets = activity.time.type === 'at' ? activity.reminderOffsetsMin : [];
  if (offsets.length === 0) return KIND[activity.kind].name;
  const span = (min: number): string =>
    min % 1440 === 0 ? `${min / 1440} d` : min % 60 === 0 ? `${min / 60} h` : `${min} min`;
  return `${KIND[activity.kind].name} · reminder ${offsets.map(span).join(' and ')} before`;
}

function buttons(activity: Activity): ActionRowData<InteractionButtonComponentData>[] {
  const button = (
    action: string,
    label: string,
    style: InteractionButtonComponentData['style'] = ButtonStyle.Primary,
    emoji?: string,
  ): InteractionButtonComponentData => ({
    type: ComponentType.Button,
    customId: `act:${activity.id}:${action}`,
    label,
    style,
    ...(emoji ? { emoji } : {}),
  });
  const all = ROLES.filter((r) => activity.slots[r.role] !== undefined).map((r) =>
    button(r.role, r.button, ButtonStyle.Primary, r.emoji),
  );
  if (activity.kind === 'raid') {
    all.push(
      button('tentative', 'Tentative', ButtonStyle.Secondary),
      button('absent', "Can't come", ButtonStyle.Secondary),
    );
  }
  all.push(button('leave', 'Leave', ButtonStyle.Danger));
  const rows: ActionRowData<InteractionButtonComponentData>[] = [];
  for (let n = 0; n < all.length; n += 5) {
    rows.push({ type: ComponentType.ActionRow, components: all.slice(n, n + 5) });
  }
  return rows;
}

/** The post as a card; `content` is cleared so older plain-text posts switch over on edit. */
export function renderActivity(view: ActivityView): {
  content: string;
  embeds: APIEmbed[];
  components: ActionRowData<InteractionButtonComponentData>[];
} {
  const { activity } = view;
  // Escape once: the search below rebuilds the text a few times.
  const signups = view.signups.map((s) => ({ ...s, label: escape(s.label) }));
  let description = text(activity, signups, signups.length);
  if (description.length > MAX_LENGTH) {
    // Binary search for the largest number of labels per list that fits (0 still shows "… and N more").
    let fits = 0;
    let tooLong = signups.length;
    while (tooLong - fits > 1) {
      const mid = Math.floor((fits + tooLong) / 2);
      if (text(activity, signups, mid).length <= MAX_LENGTH) fits = mid;
      else tooLong = mid;
    }
    description = text(activity, signups, fits);
  }
  const status = STATUS[activity.state];
  const title = `${KIND[activity.kind].emoji} ${escape(activity.title)}`.slice(0, 200);
  const embed: APIEmbed = {
    title: status ? `${title} — ${status}` : title,
    description,
    color: status ? COLOR.closed : KIND[activity.kind].color,
    footer: { text: footer(activity) },
  };
  return { content: '', embeds: [embed], components: status ? [] : buttons(activity) };
}
