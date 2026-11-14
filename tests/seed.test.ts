import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '../src/core/config.js';
import { TemplateService } from '../src/core/templates.js';
import type { Slots } from '../src/core/types.js';
import { MemoryStorage } from '../src/storage/memory.js';

type Entry = { kind: 'dungeon' | 'raid'; name: string; slots: Slots };
const entries = JSON.parse(
  readFileSync(new URL('../seed/templates.json', import.meta.url), 'utf8'),
) as Entry[];

describe('seed/templates.json', () => {
  it('has unique names per kind', () => {
    const keys = entries.map((e) => `${e.kind}:${e.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('seeds every entry into storage without error', async () => {
    const storage = new MemoryStorage();
    const service = new TemplateService(storage, new ConfigService(storage));
    expect(await service.seed('g1', entries)).toBe(entries.length);
    expect(await service.seed('g1', entries)).toBe(0);
  });
});
