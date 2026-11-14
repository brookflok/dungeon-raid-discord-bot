import {
  ButtonStyle,
  ComponentType,
  escapeMarkdown,
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

const ROLES: { role: Role; emoji: string; name: string; button: string }[] = [
  { role: 'tank', emoji: '🛡', name: 'Tank', button: 'Tank' },
  { role: 'healer', emoji: '💚', name: 'Healer', button: 'Healer' },
  { role: 'dps', emoji: '🗡', name: 'DPS', button: 'DPS' },
  { role: 'participant', emoji: '👥', name: 'Coming', button: 'Join' },
];
const KIND_EMOJI: Record<Kind, string> = { dungeon: '⚔️', raid: '🐉', event: '📅' };
const STATUS: Partial<Record<ActivityState, string>> = {
  finished: '✅ Finished',
  cancelled: '🚫 Cancelled',
  expired: '⌛ Expired',
};
const MAX_LENGTH = 2000;

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
  escapeMarkdown(text, { maskedLink: true, heading: true }).replace(/@/g, '@\u200b');

const line = (emoji: string, name: string, count: string, names: string): string =>
  `${emoji} ${name.padEnd(8)}${count.padEnd(5)} ${names}`;

function list(labels: string[], max: number): string {
  if (labels.length === 0) return '—';
  const shown = labels.slice(0, max).join(' · ');
  const rest = labels.length - Math.min(max, labels.length);
  if (rest === 0) return shown;
  return `${shown}${shown ? ' ' : ''}… and ${rest} more`;
}

/** Builds the post text from already escaped labels, showing at most `max` labels per list. */
function text(activity: Activity, signups: Signup[], max: number): string {
  const labels = (keep: (s: Signup) => boolean): string[] =>
    signups.filter(keep).map((s) => s.label);
  const others = (status: SignupStatus): string => {
    const names = labels((s) => s.status === status);
    return list(names, max);
  };
  const lines = [
    `${KIND_EMOJI[activity.kind]} **${escape(activity.title)}** · started by <@${activity.starterId}>`,
    `🕐 ${timeText(activity.time)}`,
  ];
  const status = STATUS[activity.state];
  if (status) lines.push(status);
  if (activity.description) lines.push('', escape(activity.description));
  lines.push('');
  for (const r of ROLES) {
    const cap = activity.slots[r.role];
    if (cap === undefined) continue;
    const names = labels((s) => s.role === r.role && s.status === 'confirmed');
    lines.push(line(r.emoji, r.name, `${names.length}/${cap ?? '∞'}`, list(names, max)));
  }
  if (Object.values(activity.slots).some((cap) => cap !== null)) {
    lines.push(line('⏳', 'Waitlist', '', others('waitlist')));
  }
  if (activity.kind === 'raid') {
    lines.push(line('❔', 'Tentative', '', others('tentative')));
    lines.push(line('❌', "Can't come", '', others('absent')));
  }
  return lines.join('\n');
}

function buttons(activity: Activity): ActionRowData<InteractionButtonComponentData>[] {
  const button = (
    action: string,
    label: string,
    style: InteractionButtonComponentData['style'] = ButtonStyle.Primary,
  ): InteractionButtonComponentData => ({
    type: ComponentType.Button,
    customId: `act:${activity.id}:${action}`,
    label,
    style,
  });
  const all = ROLES.filter((r) => activity.slots[r.role] !== undefined).map((r) =>
    button(r.role, r.button),
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

export function renderActivity(view: ActivityView): {
  content: string;
  components: ActionRowData<InteractionButtonComponentData>[];
} {
  const { activity } = view;
  // Escape once: the search below rebuilds the text a few times.
  const signups = view.signups.map((s) => ({ ...s, label: escape(s.label) }));
  let content = text(activity, signups, signups.length);
  if (content.length > MAX_LENGTH) {
    // Binary search for the largest number of labels per list that fits (0 still shows "… and N more").
    let fits = 0;
    let tooLong = signups.length;
    while (tooLong - fits > 1) {
      const mid = Math.floor((fits + tooLong) / 2);
      if (text(activity, signups, mid).length <= MAX_LENGTH) fits = mid;
      else tooLong = mid;
    }
    content = text(activity, signups, fits);
  }
  return { content, components: STATUS[activity.state] ? [] : buttons(activity) };
}
