import {
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { UserError, type Role } from '../core/types.js';
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

/** The form: raid, day, hour, minutes, and optionally the host's own role. */
async function form(s: Services, guildId: string): Promise<ModalBuilder> {
  const config = await s.config.get(guildId);
  requireChannel(config, 'raid');
  return new ModalBuilder()
    .setCustomId('raid:post')
    .setTitle('Post a raid')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Raid')
        .setStringSelectMenuComponent(select('raid', await templateOptions(s, guildId, 'raid'))),
      dayField(s.clock.now(), config.timezone, false),
      ...hourMinuteFields(config.timezone, false),
      new LabelBuilder()
        .setLabel('Sign yourself up as')
        .setDescription('Optional')
        .setStringSelectMenuComponent(select('signup', ROLE_OPTIONS, false)),
    );
}

export const raids: BotModule = {
  name: 'raid',
  commands: [
    new SlashCommandBuilder()
      .setName('raid')
      .setDescription('Post and manage raids (officers)')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((c) => c.setName('post').setDescription('Post a raid (opens a form)'))
      .addSubcommand(cancelSubcommand('raid'))
      .addSubcommand(timeSubcommand('raid'))
      .toJSON(),
  ],

  async onCommand(i, s) {
    if (i.options.getSubcommand() === 'post') {
      await requireHost(i, s, 'raid');
      await i.showModal(await form(s, i.guildId!)); // the acknowledgement; the rest is in onModal
      return;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await manageTarget(i, s, 'raid', await actorOf(i, s));
  },

  /** `raid:post`, the panel button. */
  async onComponent(i, s) {
    await requireHost(i, s, 'raid');
    await i.showModal(await form(s, i.guildId!));
  },

  async onModal(i, s) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await requireHost(i, s, 'raid');
    const guildId = i.guildId!; // guild-only form
    const config = await s.config.get(guildId);
    requireChannel(config, 'raid');
    const time = readFormTime(i, config.timezone, 'hourMinute');
    const role = i.fields.getStringSelectValues('signup')[0] as Role | undefined;
    const id = i.fields.getStringSelectValues('raid')[0] ?? '';
    const raid = await resolveTemplateOption(s, guildId, 'raid', id);
    // Checked before creating, so a failed signup never leaves a raid without a post.
    if (role && raid.slots[role] === undefined) {
      throw new UserError('That role is not part of this raid.');
    }
    const label = await starterLabel(i, s);
    let result = await s.activities.create({
      guildId,
      kind: 'raid',
      title: raid.title,
      starter: { userId: i.user.id, label },
      time,
      slots: raid.slots,
      reminderOffsetsMin: raid.reminderOffsetsMin,
    });
    if (role) {
      result = await s.activities.signUp(result.activity.id, i.user.id, { role, label });
    }
    await i.editReply(await posted(s, i.user.id, result, await publishNew(s, result)));
  },
};
