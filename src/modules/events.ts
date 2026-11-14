import {
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { UserError } from '../core/types.js';
import { actorOf, type BotModule } from '../discord/registry.js';
import {
  cancelSubcommand,
  messageIdFromLink,
  postLink,
  requireChannel,
  resolveTimeOption,
  starterLabel,
  timeSubcommand,
} from './shared-options.js';

const field = (id: string, style: TextInputStyle, maxLength: number, required = true) =>
  new TextInputBuilder()
    .setCustomId(id)
    .setStyle(style)
    .setMaxLength(maxLength)
    .setRequired(required);

// Title and description are capped so the post stays within Discord's 2000 characters.
const FORM = new ModalBuilder()
  .setCustomId('event:post')
  .setTitle('New event')
  .addLabelComponents(
    new LabelBuilder()
      .setLabel('Title')
      .setTextInputComponent(field('title', TextInputStyle.Short, 100)),
    new LabelBuilder()
      .setLabel('Description')
      .setTextInputComponent(field('description', TextInputStyle.Paragraph, 1000, false)),
    new LabelBuilder()
      .setLabel('When')
      .setDescription('today 20:30, tomorrow 19:00, 2026-11-20 19:00, asap or flexible')
      .setTextInputComponent(field('when', TextInputStyle.Short, 50)),
    new LabelBuilder()
      .setLabel('Maximum people')
      .setDescription('Leave empty for unlimited')
      .setTextInputComponent(field('max', TextInputStyle.Short, 4, false)),
  );

export const events: BotModule = {
  name: 'event',
  commands: [
    new SlashCommandBuilder()
      .setName('event')
      .setDescription('Plan a guild event')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((c) => c.setName('post').setDescription('Post an event (opens a form)'))
      .addSubcommand(cancelSubcommand('event'))
      .addSubcommand(timeSubcommand('event'))
      .toJSON(),
  ],

  async onCommand(i, s) {
    const sub = i.options.getSubcommand();
    if (sub === 'post') {
      await i.showModal(FORM); // the acknowledgement; the rest happens in onModal
      return;
    }

    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const guildId = i.guildId!; // guild-only command
    const actor = await actorOf(i, s);
    const messageId = messageIdFromLink(i.options.getString('post'));
    const target = await s.activities.findTarget(guildId, 'event', actor.userId, messageId);
    if (sub === 'cancel') {
      await s.publish(await s.activities.cancel(target.id, actor));
      await i.editReply('The event is cancelled.');
    } else {
      const { timezone } = await s.config.get(guildId);
      const time = resolveTimeOption(i.options.getString('when', true), s.clock.now(), timezone);
      await s.publish(await s.activities.setTime(target.id, actor, time));
      await i.editReply('The new time is set.');
    }
  },

  async onModal(i, s) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const title = i.fields.getTextInputValue('title').trim();
    if (!title) throw new UserError('Enter a title.');
    const description = i.fields.getTextInputValue('description').trim();
    const max = i.fields.getTextInputValue('max').trim();
    if (max && !(/^\d+$/.test(max) && Number(max) >= 1)) {
      throw new UserError('Maximum people must be a whole number of 1 or more, or empty.');
    }

    const guildId = i.guildId!; // guild-only command
    const config = await s.config.get(guildId);
    requireChannel(config, 'event');
    const when = i.fields.getTextInputValue('when');
    const time = resolveTimeOption(when, s.clock.now(), config.timezone);
    // The creator is not signed up; they click Join like everyone else.
    const result = await s.activities.create({
      guildId,
      kind: 'event',
      title,
      description: description || undefined,
      starter: { userId: i.user.id, label: await starterLabel(i, s) },
      time,
      slots: { participant: max ? Number(max) : null },
      reminderOffsetsMin: config.reminders.event,
    });
    await s.publish(result);
    const posted = await s.activities.get(result.activity.id);
    await i.editReply(`Your event is posted: ${postLink(posted!.activity)}`);
  },
};
