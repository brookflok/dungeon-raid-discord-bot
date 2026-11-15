import { ButtonStyle } from 'discord.js';
import type { Kind } from '../core/types.js';
import { button, notice, row } from './notice.js';

const PANEL: Record<Kind, { title: string; text: string; start: [string, string, string] }> = {
  dungeon: {
    title: '⚔️ Dungeon Finder',
    text: 'Looking for a group? Start one here, or join an open group with the buttons on its post.',
    start: ['dungeon:start', 'Start a dungeon group', '⚔️'],
  },
  raid: {
    title: '🐉 Raids',
    text: 'Officers post guild raids here. Sign up with the buttons on each raid.',
    start: ['raid:post', 'Post a raid (officers)', '🐉'],
  },
  event: {
    title: '📅 Guild Events',
    text: 'Plan something for the guild, or join an event with the button on its post.',
    start: ['event:post', 'Plan an event', '📅'],
  },
};

const HOST: Record<Kind, [string, string, string]> = {
  dungeon: ['dungeon:start', 'Host a dungeon', '⚔️'],
  raid: ['raid:post', 'Host a raid', '🐉'],
  event: ['event:post', 'Host an event', '📅'],
};

/** The permanent box with buttons that starts every flow of one kind, or hosting of `all` kinds. */
export function panel(kind: Kind | 'all') {
  const box =
    kind === 'all'
      ? notice(
          'Pick what you want to host. A form opens, and the post goes to its channel.',
          'info',
          '🎮 Host an activity',
        )
      : notice(PANEL[kind].text, 'info', PANEL[kind].title);
  const starts = kind === 'all' ? Object.values(HOST) : [PANEL[kind].start];
  return {
    ...box,
    components: [
      row(...starts.map(([id, label, emoji]) => button(id, label, ButtonStyle.Success, emoji))),
      row(
        button('profile:show', 'My characters', ButtonStyle.Secondary, '🧙'),
        button('profile:link', 'Link Battle.net', ButtonStyle.Secondary, '🔗'),
      ),
    ],
  };
}
