import { describe, expect, it } from 'vitest';
import { ConfigService } from '../../src/core/config.js';
import { TemplateService } from '../../src/core/templates.js';
import { UserError } from '../../src/core/types.js';
import { MemoryStorage } from '../../src/storage/memory.js';

function setup() {
  const storage = new MemoryStorage();
  const config = new ConfigService(storage);
  return { config, templates: new TemplateService(storage, config) };
}

const slots = { tank: 1, healer: 1, dps: 3 };

describe('TemplateService', () => {
  it('rejects invalid slots', async () => {
    const { templates } = setup();
    await expect(
      templates.add({
        guildId: 'g',
        kind: 'dungeon',
        name: 'A',
        slots: { tank: 0, healer: 0, dps: 0 },
      }),
    ).rejects.toBeInstanceOf(UserError);
    await expect(
      templates.add({ guildId: 'g', kind: 'dungeon', name: 'B', slots: { participant: 5 } }),
    ).rejects.toBeInstanceOf(UserError);
    await expect(
      templates.add({ guildId: 'g', kind: 'dungeon', name: 'C', slots: { tank: 1.5 } }),
    ).rejects.toBeInstanceOf(UserError);
  });

  it('rejects a duplicate name within guild and kind', async () => {
    const { templates } = setup();
    await templates.add({ guildId: 'g', kind: 'dungeon', name: 'Deadmines', slots });
    await expect(
      templates.add({ guildId: 'g', kind: 'dungeon', name: 'Deadmines', slots }),
    ).rejects.toBeInstanceOf(UserError);
    await templates.add({ guildId: 'g', kind: 'raid', name: 'Deadmines', slots });
  });

  it('list hides disabled templates and sorts by name', async () => {
    const { templates } = setup();
    await templates.add({ guildId: 'g', kind: 'dungeon', name: 'Zeta', slots });
    const b = await templates.add({ guildId: 'g', kind: 'dungeon', name: 'Beta', slots });
    await templates.add({ guildId: 'g', kind: 'dungeon', name: 'Alpha', slots });
    await templates.setEnabled(b.id, false);
    expect((await templates.list('g', 'dungeon')).map((t) => t.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('resolve uses the override, else the guild default, following config updates', async () => {
    const { templates, config } = setup();
    const own = await templates.add({
      guildId: 'g',
      kind: 'dungeon',
      name: 'Own',
      slots,
      reminderOffsetsMin: [30],
    });
    const dflt = await templates.add({ guildId: 'g', kind: 'dungeon', name: 'Dflt', slots });
    expect((await templates.resolve(own.id)).reminderOffsetsMin).toEqual([30]);
    const r = await templates.resolve(dflt.id);
    expect(r).toEqual({ title: 'Dflt', kind: 'dungeon', slots, reminderOffsetsMin: [15] });
    await config.update('g', { reminders: { dungeon: [20], raid: [1440, 60], event: [60] } });
    expect((await templates.resolve(dflt.id)).reminderOffsetsMin).toEqual([20]);
  });

  it('resolve rejects disabled or unknown templates', async () => {
    const { templates } = setup();
    const t = await templates.add({ guildId: 'g', kind: 'raid', name: 'R', slots });
    await templates.setEnabled(t.id, false);
    await expect(templates.resolve(t.id)).rejects.toBeInstanceOf(UserError);
    await expect(templates.resolve('nope')).rejects.toBeInstanceOf(UserError);
  });

  it('edit validates and updates', async () => {
    const { templates } = setup();
    const a = await templates.add({ guildId: 'g', kind: 'raid', name: 'A', slots });
    await templates.add({ guildId: 'g', kind: 'raid', name: 'B', slots });
    const e = await templates.edit(a.id, { slots: { tank: 2 }, reminderOffsetsMin: [10] });
    expect(e.slots).toEqual({ tank: 2 });
    expect(e.reminderOffsetsMin).toEqual([10]);
    await expect(templates.edit(a.id, { name: 'B' })).rejects.toBeInstanceOf(UserError);
    await expect(templates.edit(a.id, { slots: {} })).rejects.toBeInstanceOf(UserError);
    await expect(templates.edit(a.id, { reminderOffsetsMin: [0] })).rejects.toBeInstanceOf(
      UserError,
    );
    await expect(templates.edit('nope', { name: 'X' })).rejects.toBeInstanceOf(UserError);
  });

  it('seed run twice adds each name once', async () => {
    const { templates } = setup();
    const seeds = [
      { kind: 'dungeon' as const, name: 'Deadmines', slots },
      { kind: 'raid' as const, name: 'Molten Core', slots: { tank: 2, healer: 8, dps: 30 } },
    ];
    expect(await templates.seed('g', seeds)).toBe(2);
    expect(await templates.seed('g', seeds)).toBe(0);
    expect(await templates.list('g', 'dungeon')).toHaveLength(1);
    expect(await templates.list('g', 'raid')).toHaveLength(1);
  });
});
