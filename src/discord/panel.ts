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

/** The permanent box with buttons that starts every flow of one kind. */
export function panel(kind: Kind) {
  const { title, text, start } = PANEL[kind];
  return {
    ...notice(text, 'info', title),
    components: [
      row(button(start[0], start[1], ButtonStyle.Success, start[2])),
      row(
        button('profile:show', 'My characters', ButtonStyle.Secondary, '🧙'),
        button('profile:link', 'Link Battle.net', ButtonStyle.Secondary, '🔗'),
      ),
    ],
  };
}
