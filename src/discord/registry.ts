import {
  MessageFlags,
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { ActivityResult, ActivityService, Actor } from '../core/activities.js';
import type { ConfigService } from '../core/config.js';
import type { Clock } from '../core/ports.js';
import type { ProfileService } from '../core/profiles.js';
import type { TemplateService } from '../core/templates.js';
import { UserError } from '../core/types.js';
import type { Env } from '../env.js';

export interface Services {
  activities: ActivityService;
  templates: TemplateService;
  config: ConfigService;
  profiles: ProfileService;
  publish: (r: ActivityResult) => Promise<void>;
  env: Env;
  clock: Clock;
}

export interface BotModule {
  name: string; // also the custom-id prefix
  commands: RESTPostAPIChatInputApplicationCommandsJSONBody[];
  onCommand?(i: ChatInputCommandInteraction, s: Services): Promise<void>;
  onAutocomplete?(i: AutocompleteInteraction, s: Services): Promise<void>;
  onComponent?(i: MessageComponentInteraction, s: Services, args: string[]): Promise<void>; // customId "name:arg1:arg2"
  onModal?(i: ModalSubmitInteraction, s: Services, args: string[]): Promise<void>;
}

export function routeKey(customId: string): { module: string; args: string[] } {
  const [module, ...args] = customId.split(':');
  return { module, args };
}

export function createRouter(modules: BotModule[], s: Services): (i: Interaction) => Promise<void> {
  const byName = new Map(modules.map((m) => [m.name, m]));
  const byCommand = new Map<string, BotModule>();
  for (const m of modules) {
    for (const c of m.commands) {
      if (byCommand.has(c.name)) throw new Error(`Command "${c.name}" is registered twice.`);
      byCommand.set(c.name, m);
    }
  }

  return async (i) => {
    try {
      if (i.isChatInputCommand()) {
        await byCommand.get(i.commandName)?.onCommand?.(i, s);
      } else if (i.isAutocomplete()) {
        await byCommand.get(i.commandName)?.onAutocomplete?.(i, s);
      } else if (i.isMessageComponent()) {
        const { module, args } = routeKey(i.customId);
        await byName.get(module)?.onComponent?.(i, s, args);
      } else if (i.isModalSubmit()) {
        const { module, args } = routeKey(i.customId);
        await byName.get(module)?.onModal?.(i, s, args);
      }
    } catch (err) {
      if (!(err instanceof UserError)) console.error('interaction failed', err);
      if (!i.isRepliable()) return;
      const reply = {
        content: err instanceof UserError ? err.message : 'Something went wrong.',
        flags: MessageFlags.Ephemeral,
      } as const;
      try {
        await (i.deferred || i.replied ? i.followUp(reply) : i.reply(reply));
      } catch (replyErr) {
        console.error('interaction error reply failed', replyErr);
      }
    }
  };
}

/** Who is acting; officers per ConfigService.isOfficer (officer role or server administrator). */
export async function actorOf(i: Interaction, s: Services): Promise<Actor> {
  const userId = i.user.id;
  if (!i.guildId || !i.member) return { userId, isOfficer: false };
  const roles = i.member.roles;
  const roleIds = Array.isArray(roles) ? roles : [...roles.cache.keys()];
  const isAdmin = i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  return { userId, isOfficer: await s.config.isOfficer(i.guildId, { roleIds, isAdmin }) };
}
