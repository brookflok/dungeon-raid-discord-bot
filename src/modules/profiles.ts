import {
  ButtonStyle,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type Client,
  type SlashCommandStringOption,
} from 'discord.js';
import { CLASSES, characterLabel } from '../core/profiles.js';
import type { Character } from '../core/types.js';
import type { BotModule } from '../discord/registry.js';

const characterOption = (required: boolean) => (o: SlashCommandStringOption) =>
  o
    .setName('character')
    .setDescription(required ? 'Which character' : 'Which character; leave empty for everything')
    .setRequired(required)
    .setAutocomplete(true);

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

export const profiles: BotModule = {
  name: 'profile',
  commands: [
    new SlashCommandBuilder()
      .setName('profile')
      .setDescription('Your WoW Forever characters')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((c) =>
        c.setName('link').setDescription('Log in with Battle.net to load your characters'),
      )
      .addSubcommand((c) =>
        c
          .setName('refresh')
          .setDescription('Log in with Battle.net again to update your characters'),
      )
      .addSubcommand((c) =>
        c
          .setName('add')
          .setDescription('Add a character by hand')
          // Short names keep a character label within Discord's 100-character choice labels.
          .addStringOption((o) =>
            o.setName('name').setDescription('Character name').setRequired(true).setMaxLength(32),
          )
          .addStringOption((o) =>
            o
              .setName('class')
              .setDescription('Class')
              .setRequired(true)
              .addChoices(CLASSES.map((name) => ({ name, value: name }))),
          )
          .addIntegerOption((o) =>
            o
              .setName('level')
              .setDescription('Level')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(60),
          )
          .addStringOption((o) =>
            o.setName('surname').setDescription('Surname (optional)').setMaxLength(32),
          ),
      )
      .addSubcommand((c) => c.setName('show').setDescription('Show your characters'))
      .addSubcommand((c) =>
        c
          .setName('main')
          .setDescription('Choose your main character')
          .addStringOption(characterOption(true)),
      )
      .addSubcommand((c) =>
        c
          .setName('remove')
          .setDescription('Remove one character, or everything including the Battle.net link')
          .addStringOption(characterOption(false)),
      )
      .toJSON(),
  ],

  /** The member's own characters matching the typed text; an empty list on any error. */
  async onAutocomplete(i, s) {
    let choices: { name: string; value: string }[] = [];
    try {
      const typed = i.options.getFocused().toLowerCase();
      const { characters } = await s.profiles.list(i.user.id);
      choices = characters
        .map((c) => ({ name: characterLabel(c).slice(0, 100), value: c.id }))
        .filter((c) => c.name.toLowerCase().includes(typed))
        .slice(0, 25);
    } catch (err) {
      console.error('autocomplete failed', err);
    }
    await i.respond(choices);
  },

  async onCommand(i, s) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = i.user.id;
    const sub = i.options.getSubcommand();

    if (sub === 'link' || sub === 'refresh') {
      const { token } = await s.profiles.startLink(userId);
      await i.editReply(
        `Log in with Battle.net here: ${s.env.PUBLIC_URL}/link/${token}\n` +
          'The link is valid for 10 minutes and works once. Do not share it.',
      );
    } else if (sub === 'add') {
      const character = await s.profiles.addManual(userId, {
        name: i.options.getString('name', true),
        surname: i.options.getString('surname') ?? undefined,
        className: i.options.getString('class', true),
        level: i.options.getInteger('level', true),
      });
      await i.editReply(`Added ${characterLabel(character)}.`);
    } else if (sub === 'show') {
      const { member, characters } = await s.profiles.list(userId);
      const lines = characters.map((c) =>
        c.id === member?.mainCharacterId
          ? `⭐ ${characterLabel(c)} (main)`
          : `• ${characterLabel(c)}`,
      );
      if (lines.length === 0) lines.push('No characters yet. Use /profile link or /profile add.');
      lines.push(
        member?.battleNetId !== undefined
          ? 'Battle.net account: linked.'
          : 'Battle.net account: not linked.',
      );
      await i.editReply(lines.join('\n'));
    } else if (sub === 'main') {
      // ProfileService refuses a character that is not on this member's profile.
      await s.profiles.setMain(userId, i.options.getString('character', true));
      await i.editReply('Your main character is set.');
    } else {
      const characterId = i.options.getString('character');
      if (characterId !== null) {
        await s.profiles.removeCharacter(userId, characterId);
        await i.editReply('The character is removed.');
        return;
      }
      await i.editReply({
        content:
          'Remove all your characters and your Battle.net link from the bot? This cannot be undone.',
        components: [
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                customId: 'profile:removeall',
                label: 'Remove everything',
                style: ButtonStyle.Danger,
              },
            ],
          },
        ],
      });
    }
  },

  /** `profile:removeall`, the confirmation button of `/profile remove` without a character. */
  async onComponent(i, s, [action]) {
    await i.deferUpdate();
    if (action !== 'removeall') return;
    // The confirmation is ephemeral, so only the member it was shown to can click it; the data
    // removed is always the clicking member's own.
    await s.profiles.removeAll(i.user.id);
    await i.editReply({
      content: 'All your characters and your Battle.net link are removed.',
      components: [],
    });
  },
};
