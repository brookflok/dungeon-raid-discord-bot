import {
  ButtonStyle,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
  type SlashCommandStringOption,
} from 'discord.js';
import { CLASSES, characterLabel } from '../core/profiles.js';
import { UserError } from '../core/types.js';
import { button, linkButton, notice, row } from '../discord/notice.js';
import type { BotModule, Services } from '../discord/registry.js';
import { relabel, rememberPost } from '../discord/relabel.js';
import { log } from '../log.js';

const SHOWN = 40; // characters listed in one box

/** The private box with the single-use Battle.net login link. */
async function linkReply(s: Services, userId: string) {
  const { token } = await s.profiles.startLink(userId);
  return {
    ...notice(
      'Log in with Battle.net to load your WoW Forever characters.\n' +
        'The link is valid for 10 minutes and works once. Do not share it.',
      'info',
      '🔗 Link Battle.net',
    ),
    components: [row(linkButton(`${s.env.PUBLIC_URL}/link/${token}`, 'Log in with Battle.net'))],
  };
}

/** The member's characters with buttons to link Battle.net or add one by name. */
async function showReply(s: Services, userId: string) {
  const { member, characters } = await s.profiles.list(userId);
  const lines = characters.slice(0, SHOWN).map((c) => {
    const label = escapeMarkdown(characterLabel(c));
    return c.id === member?.mainCharacterId ? `⭐ **${label}** (main)` : `• ${label}`;
  });
  if (characters.length > SHOWN) lines.push(`… and ${characters.length - SHOWN} more`);
  if (lines.length === 0) lines.push('No characters yet. Link Battle.net or add one by name.');
  const linked = member?.battleNetId !== undefined;
  lines.push('', `Battle.net account: ${linked ? 'linked' : 'not linked'}.`);
  return {
    ...notice(lines.join('\n'), 'info', '🧙 Your characters'),
    components: [
      row(
        button(
          'profile:link',
          linked ? 'Refresh from Battle.net' : 'Link Battle.net',
          ButtonStyle.Primary,
          '🔗',
        ),
        button('profile:add', 'Add by name', ButtonStyle.Secondary, '✏️'),
      ),
    ],
  };
}

const text = (id: string, maxLength: number, required = true) =>
  new TextInputBuilder()
    .setCustomId(id)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(maxLength)
    .setRequired(required);

/** The "Add by name" form; the id carries the activity whose post should show the character. */
const addForm = (activityId?: string) =>
  new ModalBuilder()
    .setCustomId(activityId ? `profile:add:${activityId}` : 'profile:add')
    .setTitle('Add a character')
    .addLabelComponents(
      new LabelBuilder().setLabel('Name').setTextInputComponent(text('name', 32)),
      new LabelBuilder()
        .setLabel('Surname')
        .setDescription('Optional')
        .setTextInputComponent(text('surname', 32, false)),
      new LabelBuilder().setLabel('Class').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('class')
          .setRequired(true)
          .addOptions(CLASSES.map((name) => ({ label: name, value: name }))),
      ),
      new LabelBuilder()
        .setLabel('Level')
        .setDescription('1 to 60')
        .setTextInputComponent(text('level', 2)),
    );

const characterOption = (required: boolean) => (o: SlashCommandStringOption) =>
  o
    .setName('character')
    .setDescription(required ? 'Which character' : 'Which character; leave empty for everything')
    .setRequired(required)
    .setAutocomplete(true);

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
      log.error('autocomplete failed', { err });
    }
    await i.respond(choices);
  },

  async onCommand(i, s) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = i.user.id;
    const sub = i.options.getSubcommand();

    if (sub === 'link' || sub === 'refresh') {
      await i.editReply(await linkReply(s, userId));
    } else if (sub === 'add') {
      const character = await s.profiles.addManual(userId, {
        name: i.options.getString('name', true),
        surname: i.options.getString('surname') ?? undefined,
        className: i.options.getString('class', true),
        level: i.options.getInteger('level', true),
      });
      await i.editReply(notice(`Added ${escapeMarkdown(characterLabel(character))}.`, 'ok'));
    } else if (sub === 'show') {
      await i.editReply(await showReply(s, userId));
    } else if (sub === 'main') {
      // ProfileService refuses a character that is not on this member's profile.
      await s.profiles.setMain(userId, i.options.getString('character', true));
      await i.editReply(notice('Your main character is set.', 'ok'));
    } else {
      const characterId = i.options.getString('character');
      if (characterId !== null) {
        await s.profiles.removeCharacter(userId, characterId);
        await i.editReply(notice('The character is removed.', 'ok'));
        return;
      }
      await i.editReply({
        ...notice(
          'Remove all your characters and your Battle.net link from the bot? This cannot be undone.',
          'error',
        ),
        components: [row(button('profile:removeall', 'Remove everything', ButtonStyle.Danger))],
      });
    }
  },

  /**
   * `profile:removeall` (the confirmation of `/profile remove`), and from panels and
   * confirmations `profile:show`, `profile:link[:activityId]` and `profile:add[:activityId]`.
   */
  async onComponent(i, s, [action, activityId]) {
    const userId = i.user.id;
    if (action === 'add') {
      await i.showModal(addForm(activityId));
    } else if (action === 'removeall') {
      await i.deferUpdate();
      // The confirmation is ephemeral, so only the member it was shown to can click it; the data
      // removed is always the clicking member's own.
      await s.profiles.removeAll(userId);
      await i.editReply({
        ...notice('All your characters and your Battle.net link are removed.', 'ok'),
        components: [],
      });
    } else {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (action === 'show') {
        await i.editReply(await showReply(s, userId));
        return;
      }
      if (activityId) rememberPost(userId, activityId);
      await i.editReply(await linkReply(s, userId));
    }
  },

  /** `profile:add[:activityId]`, the "Add by name" form. */
  async onModal(i, s, [, activityId]) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const level = i.fields.getTextInputValue('level').trim();
    if (!/^\d+$/.test(level)) throw new UserError('Level must be a number from 1 to 60.');
    const character = await s.profiles.addManual(i.user.id, {
      name: i.fields.getTextInputValue('name'),
      surname: i.fields.getTextInputValue('surname').trim() || undefined,
      className: i.fields.getStringSelectValues('class')[0] ?? '',
      level: Number(level),
    });
    if (activityId) await relabel(s, i.user.id, activityId);
    await i.editReply(notice(`Added ${escapeMarkdown(characterLabel(character))}.`, 'ok'));
  },
};
