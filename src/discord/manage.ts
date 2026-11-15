import { MessageFlags, ModalBuilder } from 'discord.js';
import { UserError } from '../core/types.js';
import { notice } from './notice.js';
import { actorOf, type BotModule } from './registry.js';
import { dayField, hourMinuteFields, readFormTime } from './time-form.js';

/**
 * The "Change time" and "Cancel" buttons of the posted confirmation and the "Start now" button of
 * the post: `manage:<time|cancel|start>:<id>`.
 */
export const manage: BotModule = {
  name: 'manage',
  commands: [],

  async onComponent(i, s, [action, activityId]) {
    if (action === 'cancel') {
      await i.deferUpdate();
      await s.publish(await s.activities.cancel(activityId, await actorOf(i, s)));
      await i.editReply({ ...notice('It is cancelled.', 'ok'), components: [] });
      return;
    }
    if (action === 'start') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await s.publish(await s.activities.startNow(activityId, await actorOf(i, s)));
      await i.editReply(notice('The group is started and sign-ups are closed.', 'ok'));
      return;
    }
    const view = await s.activities.get(activityId);
    if (!view) throw new UserError('That group no longer exists.');
    const { timezone } = await s.config.get(view.activity.guildId);
    const open = view.activity.kind !== 'raid'; // a raid needs a date and time
    await i.showModal(
      new ModalBuilder()
        .setCustomId(`manage:time:${activityId}`)
        .setTitle('Change time')
        .addLabelComponents(
          dayField(s.clock.now(), timezone, open),
          ...hourMinuteFields(timezone, open),
        ),
    );
  },

  async onModal(i, s, [, activityId]) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const { timezone } = await s.config.get(i.guildId!); // the buttons exist only in the guild
    const time = readFormTime(i, timezone, 'hourMinute');
    await s.publish(await s.activities.setTime(activityId, await actorOf(i, s), time));
    await i.editReply(notice('The new time is set.', 'ok'));
  },
};
