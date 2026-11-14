import { randomBytes, randomUUID } from 'node:crypto';
import type { Clock, Storage } from './ports.js';
import { UserError, type Character, type LinkToken, type Member } from './types.js';

export interface FetchedCharacter {
  blizzardId: number;
  name: string;
  surname?: string;
  className: string;
  race?: string;
  faction?: string;
  level: number;
}

export const CLASSES: readonly string[] = [
  'Druid',
  'Hunter',
  'Mage',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior',
];

const LINK_TTL_MS = 10 * 60 * 1000;

export function characterLabel(
  c: Pick<Character, 'name' | 'surname' | 'className' | 'level'>,
): string {
  return `${c.surname ? `${c.name} ${c.surname}` : c.name}, ${c.className} ${c.level}`;
}

const sameName = (
  a: { name: string; surname?: string },
  b: { name: string; surname?: string },
): boolean =>
  a.name.toLowerCase() === b.name.toLowerCase() &&
  (a.surname ?? '').toLowerCase() === (b.surname ?? '').toLowerCase();

export class ProfileService {
  private readonly storage: Storage;
  private readonly clock: Clock;
  private readonly newToken: () => string;

  constructor(deps: { storage: Storage; clock: Clock; newToken?: () => string }) {
    this.storage = deps.storage;
    this.clock = deps.clock;
    this.newToken = deps.newToken ?? (() => randomBytes(32).toString('hex'));
  }

  async startLink(userId: string): Promise<LinkToken> {
    const token: LinkToken = {
      token: this.newToken(),
      userId,
      expiresAt: new Date(this.clock.now().getTime() + LINK_TTL_MS),
    };
    await this.storage.insertLinkToken(token);
    return token;
  }

  async claimLink(token: string): Promise<{ userId: string }> {
    const taken = await this.storage.takeLinkToken(token, this.clock.now());
    if (!taken)
      throw new UserError(
        'That link is invalid or has expired. Use /profile link to get a new one.',
      );
    return { userId: taken.userId };
  }

  async completeLink(
    userId: string,
    battleNetId: number,
    fetched: FetchedCharacter[],
  ): Promise<Character[]> {
    const owner = await this.storage.findMemberByBattleNet(battleNetId);
    if (owner && owner.userId !== userId) {
      throw new UserError('That Battle.net account is already linked to another member.');
    }
    const member: Member = (await this.storage.getMember(userId)) ?? { userId };
    member.battleNetId = battleNetId;

    const existing = await this.storage.listCharacters(userId);
    const now = this.clock.now();
    const kept = new Set<string>();
    const result: Character[] = [];
    for (const f of fetched) {
      const match =
        existing.find((c) => c.source === 'linked' && c.blizzardId === f.blizzardId) ??
        existing.find((c) => c.source === 'manual' && sameName(c, f));
      const character: Character = {
        id: match?.id ?? randomUUID(),
        userId,
        blizzardId: f.blizzardId,
        name: f.name,
        surname: f.surname,
        className: f.className,
        race: f.race,
        faction: f.faction,
        level: f.level,
        source: 'linked',
        updatedAt: now,
      };
      await this.storage.saveCharacter(character);
      kept.add(character.id);
      result.push(character);
    }
    for (const c of existing) {
      if (c.source === 'linked' && !kept.has(c.id)) await this.storage.deleteCharacter(c.id);
    }

    const all = [...existing.filter((c) => !kept.has(c.id) && c.source === 'manual'), ...result];
    await this.saveWithMain(member, all, undefined);
    return result;
  }

  async addManual(
    userId: string,
    input: { name: string; surname?: string; className: string; level: number },
  ): Promise<Character> {
    const name = input.name.trim();
    if (!name) throw new UserError('Enter a character name.');
    if (!CLASSES.includes(input.className)) {
      throw new UserError(`Class must be one of: ${CLASSES.join(', ')}.`);
    }
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > 60) {
      throw new UserError('Level must be between 1 and 60.');
    }
    const character: Character = {
      id: randomUUID(),
      userId,
      name,
      surname: input.surname?.trim() || undefined,
      className: input.className,
      level: input.level,
      source: 'manual',
      updatedAt: this.clock.now(),
    };
    await this.storage.saveCharacter(character);
    const member = (await this.storage.getMember(userId)) ?? { userId };
    const all = await this.storage.listCharacters(userId);
    await this.saveWithMain(member, all, character);
    return character;
  }

  async list(userId: string): Promise<{ member: Member | null; characters: Character[] }> {
    const member = await this.storage.getMember(userId);
    const characters = await this.storage.listCharacters(userId);
    characters.sort((a, b) => {
      const am = a.id === member?.mainCharacterId ? 1 : 0;
      const bm = b.id === member?.mainCharacterId ? 1 : 0;
      return bm - am || b.level - a.level;
    });
    return { member, characters };
  }

  async setMain(userId: string, characterId: string): Promise<void> {
    const member = await this.storage.getMember(userId);
    const characters = await this.storage.listCharacters(userId);
    if (!member || !characters.some((c) => c.id === characterId)) {
      throw new UserError('That character is not on your profile.');
    }
    await this.storage.saveMember({ ...member, mainCharacterId: characterId });
  }

  async removeCharacter(userId: string, characterId: string): Promise<void> {
    const member = await this.storage.getMember(userId);
    const characters = await this.storage.listCharacters(userId);
    if (!member || !characters.some((c) => c.id === characterId)) {
      throw new UserError('That character is not on your profile.');
    }
    await this.storage.deleteCharacter(characterId);
    const rest = characters.filter((c) => c.id !== characterId);
    await this.saveWithMain(member, rest, undefined);
  }

  async removeAll(userId: string): Promise<void> {
    await this.storage.deleteMember(userId);
  }

  // Keeps the current main if it still exists; otherwise uses `first` if given,
  // otherwise the highest-level remaining character.
  private async saveWithMain(
    member: Member,
    characters: Character[],
    first: Character | undefined,
  ): Promise<void> {
    if (!characters.some((c) => c.id === member.mainCharacterId)) {
      const highest = characters.reduce<Character | undefined>(
        (h, c) => (!h || c.level > h.level ? c : h),
        undefined,
      );
      member.mainCharacterId = (first ?? highest)?.id;
    }
    await this.storage.saveMember(member);
  }
}
