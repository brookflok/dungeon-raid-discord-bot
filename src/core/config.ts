import { DateTime } from 'luxon';
import type { Storage } from './ports.js';
import { UserError } from './types.js';
import type { GuildConfig, Kind } from './types.js';

export const DEFAULT_REMINDERS: Record<Kind, number[]> = {
  dungeon: [15],
  raid: [1440, 60],
  event: [60],
};

export function assertOffsets(offsets: number[]): void {
  if (!offsets.every((m) => Number.isInteger(m) && m > 0)) {
    throw new UserError('Reminder offsets must be whole minutes greater than 0.');
  }
}

export class ConfigService {
  constructor(private storage: Storage) {}

  async get(guildId: string): Promise<GuildConfig> {
    return (
      (await this.storage.getConfig(guildId)) ?? {
        guildId,
        channels: {},
        officerRoleIds: [],
        hostRoleIds: {},
        reminders: structuredClone(DEFAULT_REMINDERS),
        timezone: 'Europe/Berlin',
      }
    );
  }

  async update(
    guildId: string,
    patch: Partial<Omit<GuildConfig, 'guildId'>>,
  ): Promise<GuildConfig> {
    if (patch.timezone !== undefined && !DateTime.local().setZone(patch.timezone).isValid) {
      throw new UserError(`Unknown timezone "${patch.timezone}".`);
    }
    if (patch.reminders) {
      for (const offsets of Object.values(patch.reminders)) assertOffsets(offsets);
    }
    const next = { ...(await this.get(guildId)), ...patch, guildId };
    await this.storage.saveConfig(next);
    return next;
  }

  async isOfficer(guildId: string, who: { roleIds: string[]; isAdmin: boolean }): Promise<boolean> {
    if (who.isAdmin) return true;
    const { officerRoleIds } = await this.get(guildId);
    return who.roleIds.some((r) => officerRoleIds.includes(r));
  }

  /** Officers always; otherwise the kind's host roles, or without any: everyone except for raids. */
  async canHost(
    guildId: string,
    kind: Kind,
    who: { roleIds: string[]; isAdmin: boolean },
  ): Promise<boolean> {
    if (await this.isOfficer(guildId, who)) return true;
    const roles = (await this.get(guildId)).hostRoleIds[kind] ?? [];
    return roles.length ? who.roleIds.some((r) => roles.includes(r)) : kind !== 'raid';
  }
}
