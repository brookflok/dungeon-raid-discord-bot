import { ButtonStyle, escapeMarkdown } from 'discord.js';
import type { ActivityView } from '../core/activities.js';
import { button, linkButton, notice, row } from './notice.js';
import type { Services } from './registry.js';
import { timeText } from './render.js';

/**
 * The private confirmation after posting: go to the post, change the time, cancel, and for a
 * signed-up member without a character the offer to link Battle.net or add one by name.
 */
export async function posted(s: Services, userId: string, view: ActivityView, url: string) {
  const { activity } = view;
  const noun = activity.kind === 'dungeon' ? 'group' : activity.kind;
  let text = `**${escapeMarkdown(activity.title)}**\n🕐 ${timeText(activity.time)}`;
  const rows = [
    row(
      linkButton(url, 'Go to post'),
      button(`manage:time:${activity.id}`, 'Change time', ButtonStyle.Secondary, '🕐'),
      button(`manage:cancel:${activity.id}`, `Cancel ${noun}`, ButtonStyle.Danger),
    ),
  ];
  const { characters } = await s.profiles.list(userId);
  if (characters.length === 0 && view.signups.some((x) => x.userId === userId)) {
    text +=
      '\n\nYou are shown with your Discord name. Link your Battle.net account or add a ' +
      'character, and the post will show your character instead.';
    rows.push(
      row(
        button(`profile:link:${activity.id}`, 'Link Battle.net', ButtonStyle.Primary, '🔗'),
        button(`profile:add:${activity.id}`, 'Add by name', ButtonStyle.Secondary, '✏️'),
      ),
    );
  }
  return { ...notice(text, 'ok', `✅ Your ${noun} is posted`), components: rows };
}
