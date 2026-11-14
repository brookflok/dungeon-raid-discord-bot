import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Role } from '../core/types.js';
import { actorOf, type BotModule } from '../discord/registry.js';
import {
  ROLE_CHOICES,
  cancelSubcommand,
  manageTarget,
  publishNew,
  requireChannel,
  resolveTemplateOption,
  resolveTimeOption,
  respondTemplates,
  starterLabel,
  timeSubcommand,
  whenOption,
} from './shared-options.js';

export const dungeons: BotModule = {
  name: 'dungeon',
  commands: [
    new SlashCommandBuilder()
      .setName('dungeon')
      .setDescription('Find a group for a dungeon')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((c) =>
        c
          .setName('start')
          .setDescription('Start a dungeon group')
          .addStringOption((o) =>
            o
              .setName('dungeon')
              .setDescription('Which dungeon')
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addStringOption((o) =>
            o
              .setName('role')
              .setDescription('Your role')
              .setRequired(true)
              .addChoices(ROLE_CHOICES),
          )
          .addStringOption(whenOption(false)),
      )
      .addSubcommand(cancelSubcommand('dungeon group'))
      .addSubcommand(timeSubcommand('dungeon group'))
      .toJSON(),
  ],

  onAutocomplete: (i, s) => respondTemplates(i, s, 'dungeon'),

  async onCommand(i, s) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (i.options.getSubcommand() !== 'start') {
      await manageTarget(i, s, 'dungeon', await actorOf(i, s));
      return;
    }

    const guildId = i.guildId!; // guild-only command
    const config = await s.config.get(guildId);
    requireChannel(config, 'dungeon');
    const time = resolveTimeOption(i.options.getString('when'), s.clock.now(), config.timezone);
    const id = i.options.getString('dungeon', true);
    const dungeon = await resolveTemplateOption(s, guildId, 'dungeon', id);
    const result = await s.activities.create({
      guildId,
      kind: 'dungeon',
      title: dungeon.title,
      starter: { userId: i.user.id, label: await starterLabel(i, s) },
      starterRole: i.options.getString('role', true) as Role,
      time,
      slots: dungeon.slots,
      reminderOffsetsMin: dungeon.reminderOffsetsMin,
    });
    await i.editReply(`Your group is posted: ${await publishNew(s, result)}`);
  },
};
