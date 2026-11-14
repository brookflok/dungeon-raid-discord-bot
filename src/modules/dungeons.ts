import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Role } from '../core/types.js';
import { actorOf, type BotModule } from '../discord/registry.js';
import {
  ROLE_CHOICES,
  cancelSubcommand,
  messageIdFromLink,
  postLink,
  requireChannel,
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
    const guildId = i.guildId!; // guild-only command
    const config = await s.config.get(guildId);
    const sub = i.options.getSubcommand();

    if (sub === 'start') {
      requireChannel(config, 'dungeon');
      const time = resolveTimeOption(i.options.getString('when'), s.clock.now(), config.timezone);
      const dungeon = await s.templates.resolve(i.options.getString('dungeon', true));
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
      await s.publish(result);
      const posted = await s.activities.get(result.activity.id);
      await i.editReply(`Your group is posted: ${postLink(posted!.activity)}`);
      return;
    }

    const actor = await actorOf(i, s);
    const messageId = messageIdFromLink(i.options.getString('post'));
    const target = await s.activities.findTarget(guildId, 'dungeon', actor.userId, messageId);
    if (sub === 'cancel') {
      await s.publish(await s.activities.cancel(target.id, actor));
      await i.editReply('The group is cancelled.');
    } else {
      const when = i.options.getString('when', true);
      const time = resolveTimeOption(when, s.clock.now(), config.timezone);
      await s.publish(await s.activities.setTime(target.id, actor, time));
      await i.editReply('The new time is set.');
    }
  },
};
