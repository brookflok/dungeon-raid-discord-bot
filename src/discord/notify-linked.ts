import {
  ComponentType,
  escapeMarkdown,
  type ActionRowData,
  type Client,
  type StringSelectMenuComponentData,
} from 'discord.js';
import { characterLabel, type ProfileService } from '../core/profiles.js';
import type { Character } from '../core/types.js';
import { notice } from './notice.js';

/** The `profile:main` dropdown of the member's characters (a dropdown holds at most 25). */
export function mainMenu(
  characters: Character[],
  mainId: string | undefined,
): ActionRowData<StringSelectMenuComponentData> {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: 'profile:main',
        placeholder: 'Choose your main character',
        options: characters.slice(0, 25).map((c) => ({
          label: characterLabel(c).slice(0, 100),
          value: c.id,
          default: c.id === mainId,
        })),
      },
    ],
  };
}

/** The web server's onLinked: a direct message with the characters and the main-character menu. */
export function notifyLinked(
  client: Client,
  profiles: ProfileService,
): (userId: string) => Promise<void> {
  return async (userId) => {
    const { member, characters } = await profiles.list(userId);
    const shown = characters.slice(0, 40).map((c) => `• ${escapeMarkdown(characterLabel(c))}`);
    if (characters.length > 40) shown.push(`… and ${characters.length - 40} more`);
    const main = characters.find((c) => c.id === member?.mainCharacterId);
    const choose = characters.length > 1;
    if (main && choose) {
      shown.push(
        '',
        `Your main character is **${escapeMarkdown(characterLabel(main))}**. ` +
          'It is the one shown when you sign up. Choose another one below, or later with `/profile main`.',
      );
    }
    // The member already saw the result page; a closed inbox is not an error.
    await client.users
      .send(userId, {
        ...notice(shown.join('\n'), 'ok', '✅ Battle.net account linked'),
        components: choose ? [mainMenu(characters, member?.mainCharacterId)] : [],
      })
      .catch(() => undefined);
  };
}
