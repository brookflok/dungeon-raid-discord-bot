import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../../src/core/config.js';
import { TemplateService } from '../../src/core/templates.js';
import { UserError } from '../../src/core/types.js';
import type { Services } from '../../src/discord/registry.js';
import { resolveTemplateOption } from '../../src/modules/shared-options.js';
import { MemoryStorage } from '../../src/storage/memory.js';

const PICK_DUNGEON = 'Pick a dungeon from the list.';
const PICK_RAID = 'Pick a raid from the list.';

let s: Services;
let templates: TemplateService;
let dungeonId: string;
let raidId: string;

beforeEach(async () => {
  const storage = new MemoryStorage();
  templates = new TemplateService(storage, new ConfigService(storage));
  s = { templates } as unknown as Services;
  const add = (kind: 'dungeon' | 'raid', name: string, guildId = 'g1') =>
    templates.add({ guildId, kind, name, slots: { tank: 1, healer: 1, dps: 3 } });
  dungeonId = (await add('dungeon', 'Deadmines')).id;
  raidId = (await add('raid', 'Molten Core')).id;
});

describe('resolveTemplateOption', () => {
  it('returns the picked template of that kind', async () => {
    expect(await resolveTemplateOption(s, 'g1', 'dungeon', dungeonId)).toEqual({
      title: 'Deadmines',
      kind: 'dungeon',
      slots: { tank: 1, healer: 1, dps: 3 },
      reminderOffsetsMin: [15],
    });
  });

  it('asks to pick from the list when a name was typed instead', async () => {
    await expect(resolveTemplateOption(s, 'g1', 'dungeon', 'Deadmines')).rejects.toThrow(
      new UserError(PICK_DUNGEON),
    );
    await expect(resolveTemplateOption(s, 'g1', 'raid', 'Molten Core')).rejects.toThrow(
      new UserError(PICK_RAID),
    );
  });

  it('rejects a template of the other kind', async () => {
    await expect(resolveTemplateOption(s, 'g1', 'dungeon', raidId)).rejects.toThrow(PICK_DUNGEON);
    await expect(resolveTemplateOption(s, 'g1', 'raid', dungeonId)).rejects.toThrow(PICK_RAID);
  });

  it('rejects a disabled template and one of another guild', async () => {
    await templates.setEnabled(dungeonId, false);
    await expect(resolveTemplateOption(s, 'g1', 'dungeon', dungeonId)).rejects.toThrow(
      PICK_DUNGEON,
    );
    await expect(resolveTemplateOption(s, 'g2', 'raid', raidId)).rejects.toThrow(PICK_RAID);
  });
});
