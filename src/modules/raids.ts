import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { UserError, type Role } from '../core/types.js';
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

export const raids: BotModule = {
  name: 'raid',
  commands: [
    new SlashCommandBuilder()
      .setName('raid')
      .setDescription('Post and manage raids (officers)')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((c) =>
        c
          .setName('post')
          .setDescription('Post a raid')
          .addStringOption((o) =>
            o.setName('raid').setDescription('Which raid').setRequired(true).setAutocomplete(true),
          )
          .addStringOption(whenOption(true))
          .addStringOption((o) =>
            o
              .setName('signup')
              .setDescription('Sign yourself up with this role')
              .addChoices(ROLE_CHOICES),
          ),
      )
      .addSubcommand(cancelSubcommand('raid'))
      .addSubcommand(timeSubcommand('raid'))
      .toJSON(),
  ],

  onAutocomplete: (i, s) => respondTemplates(i, s, 'raid'),

  async onCommand(i, s) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const actor = await actorOf(i, s);
    if (!actor.isOfficer) throw new UserError('Only officers can post raids.');
    if (i.options.getSubcommand() !== 'post') {
      await manageTarget(i, s, 'raid', actor);
      return;
    }

    const guildId = i.guildId!; // guild-only command
    const config = await s.config.get(guildId);
    requireChannel(config, 'raid');
    const when = i.options.getString('when', true);
    const time = resolveTimeOption(when, s.clock.now(), config.timezone);
    const role = i.options.getString('signup') as Role | null;
    const raid = await resolveTemplateOption(s, guildId, 'raid', i.options.getString('raid', true));
    // Checked before creating, so a failed signup never leaves a raid without a post.
    if (role && raid.slots[role] === undefined) {
      throw new UserError('That role is not part of this raid.');
    }
    const label = await starterLabel(i, s);
    let result = await s.activities.create({
      guildId,
      kind: 'raid',
      title: raid.title,
      starter: { userId: actor.userId, label },
      time,
      slots: raid.slots,
      reminderOffsetsMin: raid.reminderOffsetsMin,
    });
    if (role) {
      result = await s.activities.signUp(result.activity.id, actor.userId, { role, label });
    }
    await i.editReply(`Your raid is posted: ${await publishNew(s, result)}`);
  },
};
