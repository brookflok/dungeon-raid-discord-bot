import {
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import type { Role } from '../core/types.js';
import { posted } from '../discord/posted.js';
import { actorOf, requireHost, type BotModule, type Services } from '../discord/registry.js';
import { dayField, hourMinuteFields, readFormTime } from '../discord/time-form.js';
import {
  ROLE_OPTIONS,
  cancelSubcommand,
  manageTarget,
  publishNew,
  requireChannel,
  resolveTemplateOption,
  select,
  starterLabel,
  templateOptions,
  timeSubcommand,
} from './shared-options.js';

/** The form: dungeon, own role, day, hour, minutes. */
async function form(s: Services, guildId: string): Promise<ModalBuilder> {
  const config = await s.config.get(guildId);
  requireChannel(config, 'dungeon');
  return new ModalBuilder()
    .setCustomId('dungeon:start')
    .setTitle('Start a dungeon group')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Dungeon')
        .setStringSelectMenuComponent(
          select('dungeon', await templateOptions(s, guildId, 'dungeon')),
        ),
      new LabelBuilder()
        .setLabel('Your role')
        .setStringSelectMenuComponent(select('role', ROLE_OPTIONS)),
      dayField(s.clock.now(), config.timezone, true),
      ...hourMinuteFields(config.timezone, true),
    );
}

export const dungeons: BotModule = {
  name: 'dungeon',
  commands: [
    new SlashCommandBuilder()
      .setName('dungeon')
      .setDescription('Find a group for a dungeon')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((c) =>
        c.setName('start').setDescription('Start a dungeon group (opens a form)'),
      )
      .addSubcommand(cancelSubcommand('dungeon group'))
      .addSubcommand(timeSubcommand('dungeon group'))
      .toJSON(),
  ],

  async onCommand(i, s) {
    if (i.options.getSubcommand() === 'start') {
      await requireHost(i, s, 'dungeon');
      await i.showModal(await form(s, i.guildId!)); // the acknowledgement; the rest is in onModal
      return;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await manageTarget(i, s, 'dungeon', await actorOf(i, s));
  },

  /** `dungeon:start`, the panel button. */
  async onComponent(i, s) {
    await requireHost(i, s, 'dungeon');
    await i.showModal(await form(s, i.guildId!));
  },

  async onModal(i, s) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await requireHost(i, s, 'dungeon');
    const guildId = i.guildId!; // guild-only form
    const config = await s.config.get(guildId);
    requireChannel(config, 'dungeon');
    const time = readFormTime(i, config.timezone, 'hourMinute');
    const id = i.fields.getStringSelectValues('dungeon')[0] ?? '';
    const dungeon = await resolveTemplateOption(s, guildId, 'dungeon', id);
    const result = await s.activities.create({
      guildId,
      kind: 'dungeon',
      title: dungeon.title,
      starter: { userId: i.user.id, label: await starterLabel(i, s) },
      starterRole: i.fields.getStringSelectValues('role')[0] as Role,
      time,
      slots: dungeon.slots,
      reminderOffsetsMin: dungeon.reminderOffsetsMin,
    });
    await i.editReply(await posted(s, i.user.id, result, await publishNew(s, result)));
  },
};
