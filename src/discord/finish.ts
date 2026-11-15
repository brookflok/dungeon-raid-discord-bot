import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { UserError, type Outcome } from '../core/types.js';
import { notice } from './notice.js';
import { actorOf, type BotModule } from './registry.js';
import { OUTCOME } from './render.js';

/** The "Finish" and "Add result" buttons `finish:<id>` and their form: a result and a report. */
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
    await i.showModal(
      new ModalBuilder()
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
            .setDescription('Optional: how did it go?')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('report')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(false),
            ),
        ),
    );
  },

  async onModal(i, s, [activityId]) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const outcome = i.fields.getStringSelectValues('outcome')[0] ?? '';
    if (!(outcome in OUTCOME)) throw new UserError('Pick a result from the list.');
    const report = i.fields.getTextInputValue('report');
    const actor = await actorOf(i, s);
    await s.publish(await s.activities.report(activityId, actor, outcome as Outcome, report));
    await i.editReply(notice('Thanks, the result is recorded.', 'ok'));
  },
};
