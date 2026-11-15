import {
  ComponentType,
  MessageFlags,
  escapeMarkdown,
  type MessageComponentInteraction,
} from 'discord.js';
import type { ActivityResult } from '../core/activities.js';
import { characterLabel } from '../core/profiles.js';
import { UserError, type Character, type Role } from '../core/types.js';
import { notice } from './notice.js';
import type { BotModule } from './registry.js';

/** The first character (the main, as ProfileService.list sorts) or the member's display name. */
function labelFor(characters: Character[], i: MessageComponentInteraction): string {
  if (characters[0]) return characterLabel(characters[0]);
  return i.inCachedGuild() ? i.member.displayName : i.user.displayName;
}

/** Post buttons `act:<id>:<role|tentative|absent|leave>` and the character menu `act:<id>:pick:<role>`. */
export const signupButtons: BotModule = {
  name: 'act',
  commands: [],
  async onComponent(i, s, [activityId, action, pickedRole]) {
    await i.deferUpdate();
    const userId = i.user.id;
    let result: ActivityResult;

    if (action === 'leave') {
      result = await s.activities.leave(activityId, userId);
    } else if (action === 'pick' && i.isStringSelectMenu()) {
      // Resolve the label from the member's own characters, never from the client.
      const { characters } = await s.profiles.list(userId);
      const character = characters.find((c) => c.id === i.values[0]);
      if (!character) throw new UserError('That character is not on your profile.');
      const label = characterLabel(character);
      result = await s.activities.signUp(activityId, userId, { role: pickedRole as Role, label });
      await i.editReply({
        ...notice(`Signed up as ${escapeMarkdown(label)}.`, 'ok'),
        components: [],
      });
    } else {
      const { characters } = await s.profiles.list(userId);
      if (action === 'tentative' || action === 'absent') {
        result = await s.activities.signUp(activityId, userId, {
          status: action,
          label: labelFor(characters, i),
        });
      } else if (characters.length > 1) {
        await i.followUp({
          ...notice('Which character do you want to sign up with?'),
          flags: MessageFlags.Ephemeral,
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.StringSelect,
                  customId: `act:${activityId}:pick:${action}`,
                  options: characters
                    .slice(0, 25)
                    .map((c) => ({ label: characterLabel(c), value: c.id })),
                },
              ],
            },
          ],
        });
        return;
      } else {
        result = await s.activities.signUp(activityId, userId, {
          role: action as Role,
          label: labelFor(characters, i),
        });
      }
    }
    await s.publish(result);
  },
};
