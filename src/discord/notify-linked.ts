import type { Client } from 'discord.js';
import { characterLabel } from '../core/profiles.js';
import type { Character } from '../core/types.js';

/** The web server's onLinked: a direct message listing the linked characters. */
export function notifyLinked(
  client: Client,
): (userId: string, characters: Character[]) => Promise<void> {
  return async (userId, characters) => {
    const list = characters.map((c) => `• ${characterLabel(c)}`).join('\n');
    // The member already saw the result page; a closed inbox is not an error.
    await client.users
      .send(userId, `Your Battle.net account is linked. Characters:\n${list}`)
      .catch(() => undefined);
  };
}
