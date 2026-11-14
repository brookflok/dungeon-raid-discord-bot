import { randomUUID } from 'node:crypto';
import type { Storage } from './ports.js';
import { assertOffsets } from './config.js';
import type { ConfigService } from './config.js';
import { UserError } from './types.js';
import type { Slots, Template } from './types.js';

const SLOT_ROLES = ['tank', 'healer', 'dps'];

function assertSlots(slots: Slots): void {
  const entries = Object.entries(slots);
  if (entries.some(([role]) => !SLOT_ROLES.includes(role))) {
    throw new UserError('Template slots may only use tank, healer and dps.');
  }
  if (!entries.every(([, n]) => Number.isInteger(n) && (n as number) >= 0)) {
    throw new UserError('Slot counts must be whole numbers of 0 or more.');
  }
  if (entries.reduce((sum, [, n]) => sum + (n as number), 0) < 1) {
    throw new UserError('A template needs at least one slot.');
  }
}

/** A role with 0 slots is not part of the group, so it is not stored. */
function withoutEmpty(slots: Slots): Slots {
  return Object.fromEntries(Object.entries(slots).filter(([, n]) => n !== 0)) as Slots;
}

export class TemplateService {
  constructor(
    private storage: Storage,
    private config: ConfigService,
  ) {}

  private async assertNameFree(
    guildId: string,
    kind: 'dungeon' | 'raid',
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.storage.listTemplates(guildId, kind);
    if (existing.some((t) => t.name === name && t.id !== exceptId)) {
      throw new UserError(`A ${kind} template named "${name}" already exists.`);
    }
  }

  private async require(id: string): Promise<Template> {
    const t = await this.storage.getTemplate(id);
    if (!t) throw new UserError('Template not found.');
    return t;
  }

  async add(input: {
    guildId: string;
    kind: 'dungeon' | 'raid';
    name: string;
    slots: Slots;
    reminderOffsetsMin?: number[];
  }): Promise<Template> {
    assertSlots(input.slots);
    if (input.reminderOffsetsMin) assertOffsets(input.reminderOffsetsMin);
    await this.assertNameFree(input.guildId, input.kind, input.name);
    const t: Template = {
      id: randomUUID(),
      enabled: true,
      ...input,
      slots: withoutEmpty(input.slots),
    };
    await this.storage.insertTemplate(t);
    return t;
  }

  async edit(
    id: string,
    patch: { name?: string; slots?: Slots; reminderOffsetsMin?: number[] },
  ): Promise<Template> {
    const t = await this.require(id);
    if (patch.slots) assertSlots(patch.slots);
    if (patch.reminderOffsetsMin) assertOffsets(patch.reminderOffsetsMin);
    if (patch.name !== undefined) await this.assertNameFree(t.guildId, t.kind, patch.name, id);
    const next = { ...t, ...patch };
    if (patch.slots) next.slots = withoutEmpty(patch.slots);
    await this.storage.updateTemplate(next);
    return next;
  }

  async setEnabled(id: string, enabled: boolean): Promise<Template> {
    const next = { ...(await this.require(id)), enabled };
    await this.storage.updateTemplate(next);
    return next;
  }

  async list(guildId: string, kind: 'dungeon' | 'raid'): Promise<Template[]> {
    const all = await this.storage.listTemplates(guildId, kind);
    return all.filter((t) => t.enabled).sort((a, b) => a.name.localeCompare(b.name));
  }

  async listAll(guildId: string, kind: 'dungeon' | 'raid'): Promise<Template[]> {
    const all = await this.storage.listTemplates(guildId, kind);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  async resolve(id: string): Promise<{
    title: string;
    kind: 'dungeon' | 'raid';
    slots: Slots;
    reminderOffsetsMin: number[];
  }> {
    const t = await this.storage.getTemplate(id);
    if (!t || !t.enabled) throw new UserError('Template not found.');
    const reminderOffsetsMin =
      t.reminderOffsetsMin ?? (await this.config.get(t.guildId)).reminders[t.kind];
    return { title: t.name, kind: t.kind, slots: t.slots, reminderOffsetsMin };
  }

  async seed(
    guildId: string,
    templates: { kind: 'dungeon' | 'raid'; name: string; slots: Slots }[],
  ): Promise<number> {
    // Only a guild without any template is seeded, so a seeded template that officers renamed
    // or disabled is never added again.
    if ((await this.storage.listTemplates(guildId)).length > 0) return 0;
    for (const t of templates) await this.add({ guildId, ...t });
    return templates.length;
  }
}
