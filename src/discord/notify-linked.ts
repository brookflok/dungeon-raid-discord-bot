import { escapeMarkdown, type Client } from 'discord.js';
import { characterLabel } from '../core/profiles.js';
import type { Character } from '../core/types.js';
import { notice } from './notice.js';

/** The web server's onLinked: a direct message listing the linked characters. */
export function notifyLinked(
  client: Client,
): (userId: string, characters: Character[]) => Promise<void> {
  return async (userId, characters) => {
    const shown = characters.slice(0, 40).map((c) => `• ${escapeMarkdown(characterLabel(c))}`);
    if (characters.length > 40) shown.push(`… and ${characters.length - 40} more`);
    // The member already saw the result page; a closed inbox is not an error.
    await client.users
      .send(userId, notice(shown.join('\n'), 'ok', '✅ Battle.net account linked'))
      .catch(() => undefined);
  };
}
