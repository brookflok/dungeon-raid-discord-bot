import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  messageLink,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ActivityView } from '../core/activities.js';
import { UserError, type Outcome } from '../core/types.js';
import { log } from '../log.js';
import { COLOR, linkButton, notice, row } from './notice.js';
import { actorOf, type BotModule } from './registry.js';
import { OUTCOME, escape } from './render.js';

const field = (id: string): TextInputBuilder =>
  new TextInputBuilder()
    .setCustomId(id)
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(false);

/** The message for the officers' channel: who reported what about which group. */
export function privateReport({ activity, signups }: ActivityView, userId: string, text: string) {
  const result = activity.outcome ? OUTCOME[activity.outcome].name : 'No result';
  const members = signups
    .filter((s) => s.status === 'confirmed')
    .map((s) => `<@${s.userId}> ${escape(s.label)}`);
  const lines = [
    `👤 Reported by <@${userId}>`,
    `🏁 Result: ${result}`,
    '',
    '**Members**',
    ...(members.length ? members.slice(0, 40) : ['Nobody signed up.']),
    '',
    '📝 **Report**',
    escape(text),
  ];
  const { guildId, logChannelId, logMessageId } = activity;
  return {
    embeds: [
      {
        title: `🚩 Private report — ${escape(activity.title)}`.slice(0, 256),
        description: lines.join('\n'),
        color: COLOR.error,
      },
    ],
    components:
      logChannelId && logMessageId
        ? [row(linkButton(messageLink(logChannelId, logMessageId, guildId), 'Go to the log entry'))]
        : [],
    allowedMentions: { parse: [] },
  };
}

/**
 * The "Finish" and "Add result" buttons `finish:<id>` and their form: a result, a public report
 * and, when an officers' channel is set, a private report that goes only there.
 */
export const finish: BotModule = {
  name: 'finish',
  commands: [],

  async onComponent(i, s, [activityId]) {
    const view = await s.activities.get(activityId);
    if (!view) throw new UserError('That group no longer exists.');
    const { activity } = view;
    // Checked here too, so only someone who may submit the form gets to see it.
    const actor = await actorOf(i, s);
    if (actor.userId !== activity.starterId && !actor.isOfficer) {
      throw new UserError('Only the starter or an officer can do that.');
    }
    if (activity.outcome) throw new UserError('The result is already recorded.');
    const form = new ModalBuilder()
      .setCustomId(`finish:${activityId}`)
      .setTitle(`Finish: ${activity.title}`.slice(0, 45))
      .addLabelComponents(
        new LabelBuilder().setLabel('Result').setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('outcome')
            .setRequired(true)
            .addOptions(
              Object.entries(OUTCOME).map(([value, o]) => ({
                label: o.name,
                value,
                emoji: { name: o.emoji },
              })),
            ),
        ),
        new LabelBuilder()
          .setLabel('Report')
          .setDescription('Optional: how did it go? Everyone can read this in the log.')
          .setTextInputComponent(field('report')),
      );
    if ((await s.config.get(activity.guildId)).channels.officers) {
      form.addLabelComponents(
        new LabelBuilder()
          .setLabel('Private report to the officers')
          .setDescription('Optional: bad behaviour or another problem. Only officers see this.')
          .setTextInputComponent(field('private')),
      );
    }
    await i.showModal(form);
  },

  async onModal(i, s, [activityId]) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const outcome = i.fields.getStringSelectValues('outcome')[0] ?? '';
    if (!(outcome in OUTCOME)) throw new UserError('Pick a result from the list.');
    const report = i.fields.getTextInputValue('report');
    // The private field exists only when an officers' channel is set.
    const channelId = (await s.config.get(i.guildId!)).channels.officers;
    const secret = channelId ? i.fields.getTextInputValue('private').trim() : '';
    const actor = await actorOf(i, s);
    await s.publish(await s.activities.report(activityId, actor, outcome as Outcome, report));
    if (!channelId || !secret) {
      await i.editReply(notice('Thanks, the result is recorded.', 'ok'));
      return;
    }
    try {
      const channel = await i.client.channels.fetch(channelId);
      if (!channel?.isSendable()) throw new Error(`channel ${channelId} is not sendable`);
      // Re-read: the publish above stored where the log entry is.
      const view = (await s.activities.get(activityId))!;
      await channel.send(privateReport(view, i.user.id, secret));
    } catch (err) {
      log.error('private report', { activityId, err });
      await i.editReply(
        notice(
          'The result is recorded, but I could not deliver your private report. Please tell an officer directly.',
          'error',
        ),
      );
      return;
    }
    await i.editReply(
      notice('Thanks, the result is recorded and your private report went to the officers.', 'ok'),
    );
  },
};
