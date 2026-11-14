import { beforeEach, describe, expect, it } from 'vitest';
import { characterLabel, ProfileService, type FetchedCharacter } from '../../src/core/profiles.js';
import type { Clock } from '../../src/core/ports.js';
import { UserError } from '../../src/core/types.js';
import { MemoryStorage } from '../../src/storage/memory.js';

class FakeClock implements Clock {
  constructor(private current = new Date('2026-11-14T12:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms = 1000): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

let storage: MemoryStorage;
let clock: FakeClock;
let svc: ProfileService;
let n: number;

beforeEach(() => {
  storage = new MemoryStorage();
  clock = new FakeClock();
  n = 0;
  svc = new ProfileService({ storage, clock, newToken: () => `tok${n++}` });
});

const brook: FetchedCharacter = {
  blizzardId: 1,
  name: 'Brook',
  surname: 'Flok',
  className: 'Priest',
  race: 'Human',
  faction: 'Alliance',
  level: 37,
};
const thrall: FetchedCharacter = { blizzardId: 2, name: 'Thrall', className: 'Shaman', level: 42 };

describe('characterLabel', () => {
  it('formats with and without surname', () => {
    expect(characterLabel({ name: 'Brook', surname: 'Flok', className: 'Priest', level: 37 })).toBe(
      'Brook Flok, Priest 37',
    );
    expect(characterLabel({ name: 'Thrall', className: 'Shaman', level: 42 })).toBe(
      'Thrall, Shaman 42',
    );
  });
});

describe('link tokens', () => {
  it('is single use', async () => {
    const t = await svc.startLink('u1');
    expect(await svc.claimLink(t.token)).toEqual({ userId: 'u1' });
    await expect(svc.claimLink(t.token)).rejects.toBeInstanceOf(UserError);
  });

  it('expires after 10 minutes', async () => {
    const t = await svc.startLink('u1');
    expect(t.expiresAt).toEqual(new Date('2026-11-14T12:10:00Z'));
    clock.advance(10 * 60 * 1000 + 1000);
    await expect(svc.claimLink(t.token)).rejects.toBeInstanceOf(UserError);
  });

  it('rejects unknown tokens', async () => {
    await expect(svc.claimLink('nope')).rejects.toBeInstanceOf(UserError);
  });
});

describe('completeLink', () => {
  it('stores characters and sets main to the first', async () => {
    const chars = await svc.completeLink('u1', 100, [brook, thrall]);
    expect(chars).toHaveLength(2);
    const { member, characters } = await svc.list('u1');
    expect(member?.battleNetId).toBe(100);
    const main = characters.find((c) => c.id === member?.mainCharacterId);
    expect(main?.name).toBe('Brook');
    expect(characters.every((c) => c.source === 'linked')).toBe(true);
  });

  it('relink updates levels, removes vanished linked, keeps manual', async () => {
    await svc.completeLink('u1', 100, [brook, thrall]);
    await svc.addManual('u1', { name: 'Manny', className: 'Mage', level: 10 });
    await svc.completeLink('u1', 100, [{ ...brook, level: 40 }]);
    const { characters } = await svc.list('u1');
    expect(characters.map((c) => c.name).sort()).toEqual(['Brook', 'Manny']);
    expect(characters.find((c) => c.name === 'Brook')?.level).toBe(40);
  });

  it('merges a manual character with the same name and surname', async () => {
    await svc.addManual('u1', { name: 'brook', surname: 'flok', className: 'Priest', level: 30 });
    await svc.completeLink('u1', 100, [brook]);
    const { characters } = await svc.list('u1');
    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({
      name: 'Brook',
      source: 'linked',
      blizzardId: 1,
      level: 37,
    });
  });

  it('refuses a battle.net account linked to another member and changes nothing', async () => {
    await svc.completeLink('u1', 100, [brook]);
    await expect(svc.completeLink('u2', 100, [thrall])).rejects.toThrow(
      'That Battle.net account is already linked to another member.',
    );
    expect(await storage.getMember('u2')).toBeNull();
    expect(await storage.listCharacters('u2')).toEqual([]);
    expect(await storage.listCharacters('u1')).toHaveLength(1);
  });
});

describe('main character and removal', () => {
  it('first manual character becomes main; list orders main first then level desc', async () => {
    const a = await svc.addManual('u1', { name: 'A', className: 'Mage', level: 5 });
    await svc.addManual('u1', { name: 'B', className: 'Mage', level: 20 });
    await svc.addManual('u1', { name: 'C', className: 'Mage', level: 50 });
    const { member, characters } = await svc.list('u1');
    expect(member?.mainCharacterId).toBe(a.id);
    expect(characters.map((c) => c.name)).toEqual(['A', 'C', 'B']);
  });

  it('setMain changes main', async () => {
    await svc.addManual('u1', { name: 'A', className: 'Mage', level: 5 });
    const b = await svc.addManual('u1', { name: 'B', className: 'Mage', level: 20 });
    await svc.setMain('u1', b.id);
    expect((await svc.list('u1')).member?.mainCharacterId).toBe(b.id);
  });

  it('removing the main promotes the highest level', async () => {
    const a = await svc.addManual('u1', { name: 'A', className: 'Mage', level: 5 });
    await svc.addManual('u1', { name: 'B', className: 'Mage', level: 20 });
    const c = await svc.addManual('u1', { name: 'C', className: 'Mage', level: 50 });
    await svc.removeCharacter('u1', a.id);
    const { member, characters } = await svc.list('u1');
    expect(member?.mainCharacterId).toBe(c.id);
    expect(characters).toHaveLength(2);
  });

  it('removeAll leaves no member and no characters', async () => {
    await svc.completeLink('u1', 100, [brook, thrall]);
    await svc.removeAll('u1');
    expect(await svc.list('u1')).toEqual({ member: null, characters: [] });
  });
});

describe('addManual validation', () => {
  it('rejects bad class, level and empty name', async () => {
    await expect(
      svc.addManual('u1', { name: 'X', className: 'Monk', level: 10 }),
    ).rejects.toBeInstanceOf(UserError);
    await expect(
      svc.addManual('u1', { name: 'X', className: 'Mage', level: 61 }),
    ).rejects.toBeInstanceOf(UserError);
    await expect(
      svc.addManual('u1', { name: 'X', className: 'Mage', level: 0 }),
    ).rejects.toBeInstanceOf(UserError);
    await expect(
      svc.addManual('u1', { name: ' ', className: 'Mage', level: 10 }),
    ).rejects.toBeInstanceOf(UserError);
  });
});
