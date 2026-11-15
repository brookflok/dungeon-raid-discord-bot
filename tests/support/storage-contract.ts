import { beforeEach, describe, expect, it } from 'vitest';
import type { Storage } from '../../src/core/ports.js';
import type {
  Activity,
  Character,
  GuildConfig,
  Signup,
  Template,
  TimeSpec,
} from '../../src/core/types.js';

const d = (iso: string) => new Date(iso);

function activity(id: string, time: TimeSpec, extra: Partial<Activity> = {}): Activity {
  return {
    id,
    guildId: 'g1',
    kind: 'dungeon',
    title: 'Deadmines',
    starterId: 'u1',
    time,
    slots: { tank: 1, healer: 1, dps: 3 },
    reminderOffsetsMin: [15],
    state: 'open',
    createdAt: d('2026-11-14T10:00:00Z'),
    ...extra,
  };
}

function signup(userId: string, createdAt: string, extra: Partial<Signup> = {}): Signup {
  return {
    activityId: 'a1',
    userId,
    role: 'dps',
    status: 'confirmed',
    label: userId,
    createdAt: d(createdAt),
    ...extra,
  };
}

function template(id: string, kind: 'dungeon' | 'raid'): Template {
  return { id, guildId: 'g1', kind, name: id, slots: { dps: 5 }, enabled: true };
}

function character(id: string, userId: string): Character {
  return {
    id,
    userId,
    name: id,
    className: 'Mage',
    level: 60,
    source: 'manual',
    updatedAt: d('2026-11-14T10:00:00Z'),
  };
}

export function storageContract(name: string, make: () => Promise<Storage>): void {
  describe(`Storage contract: ${name}`, () => {
    let s: Storage;
    beforeEach(async () => {
      s = await make();
    });

    describe('activities', () => {
      it('returns null for an unknown id', async () => {
        expect(await s.getActivity('nope')).toBeNull();
      });

      it('round-trips an activity for each time type', async () => {
        const times: TimeSpec[] = [
          { type: 'at', at: d('2026-11-20T18:00:00Z') },
          { type: 'asap' },
          { type: 'flexible' },
        ];
        for (const [i, time] of times.entries()) {
          const a = activity(`a${i}`, time, {
            description: 'bring flasks',
            filledAt: d('2026-11-14T11:00:00Z'),
            startedAt: d('2026-11-14T11:30:00Z'),
            channelId: 'c1',
            messageId: 'm1',
            threadId: 't1',
            outcome: 'completed',
            report: 'Clean run.',
            logChannelId: 'c9',
            logMessageId: 'm9',
          });
          await s.insertActivity(a);
          expect(await s.getActivity(a.id)).toEqual(a);
        }
      });

      it('round-trips slots with an unlimited (null) count', async () => {
        const a = activity('a1', { type: 'flexible' }, { slots: { tank: 2, participant: null } });
        await s.insertActivity(a);
        expect(await s.getActivity('a1')).toEqual(a);
      });

      it('updates an activity', async () => {
        const a = activity('a1', { type: 'asap' });
        await s.insertActivity(a);
        await s.updateActivity({ ...a, state: 'full', title: 'Renamed' });
        expect(await s.getActivity('a1')).toEqual({ ...a, state: 'full', title: 'Renamed' });
      });

      it('returns copies, not references', async () => {
        await s.insertActivity(activity('a1', { type: 'asap' }));
        const first = await s.getActivity('a1');
        first!.title = 'mutated';
        first!.slots.tank = 99;
        expect((await s.getActivity('a1'))!.title).toBe('Deadmines');
        expect((await s.getActivity('a1'))!.slots.tank).toBe(1);
      });

      it('findOpenActivities returns open and full ones of that starter and kind, newest first', async () => {
        const at = (hour: string) => ({ createdAt: d(`2026-11-14T${hour}:00:00Z`) });
        const newest = activity('new', { type: 'asap' }, { ...at('12'), state: 'full' });
        await s.insertActivity(activity('old', { type: 'asap' }, at('10')));
        await s.insertActivity(newest);
        await s.insertActivity(activity('mid', { type: 'asap' }, at('11')));
        for (const state of ['finished', 'cancelled', 'expired'] as const) {
          await s.insertActivity(activity(state, { type: 'asap' }, { ...at('13'), state }));
        }
        await s.insertActivity(activity('raid', { type: 'asap' }, { ...at('13'), kind: 'raid' }));
        await s.insertActivity(
          activity('theirs', { type: 'asap' }, { ...at('13'), starterId: 'u2' }),
        );
        await s.insertActivity(
          activity('elsewhere', { type: 'asap' }, { ...at('13'), guildId: 'g2' }),
        );

        const found = await s.findOpenActivities('g1', 'dungeon', 'u1');
        expect(found.map((a) => a.id)).toEqual(['new', 'mid', 'old']);
        expect(found[0]).toEqual(newest);
        expect(await s.findOpenActivities('g1', 'event', 'u1')).toEqual([]);
      });

      it('findActivityByMessage returns the activity posted as that message, or null', async () => {
        const posted = activity('a1', { type: 'asap' }, { channelId: 'c1', messageId: 'm1' });
        await s.insertActivity(posted);
        await s.insertActivity(
          activity('a2', { type: 'asap' }, { channelId: 'c1', messageId: 'm2' }),
        );
        await s.insertActivity(activity('a3', { type: 'asap' }));
        expect(await s.findActivityByMessage('m1')).toEqual(posted);
        expect(await s.findActivityByMessage('nope')).toBeNull();
      });
    });

    describe('signups', () => {
      it('lists signups ordered by createdAt', async () => {
        await s.upsertSignup(signup('late', '2026-11-14T12:00:00Z'));
        await s.upsertSignup(signup('early', '2026-11-14T10:00:00Z'));
        await s.upsertSignup(signup('mid', '2026-11-14T11:00:00Z'));
        const list = await s.listSignups('a1');
        expect(list.map((x) => x.userId)).toEqual(['early', 'mid', 'late']);
      });

      it('keeps insertion order for signups with the same createdAt', async () => {
        await s.upsertSignup(signup('b', '2026-11-14T10:00:00Z'));
        await s.upsertSignup(signup('a', '2026-11-14T10:00:00Z'));
        await s.upsertSignup(signup('c', '2026-11-14T10:00:00Z'));
        await s.upsertSignup(signup('b', '2026-11-14T10:00:00Z', { label: 'again' }));
        expect((await s.listSignups('a1')).map((x) => x.userId)).toEqual(['b', 'a', 'c']);
      });

      it('upsert replaces the same user and keeps other activities separate', async () => {
        await s.upsertSignup(signup('u1', '2026-11-14T10:00:00Z'));
        await s.upsertSignup(
          signup('u1', '2026-11-14T10:00:00Z', {
            role: undefined,
            status: 'tentative',
            label: 'maybe',
          }),
        );
        await s.upsertSignup({ ...signup('u1', '2026-11-14T10:00:00Z'), activityId: 'other' });
        expect(await s.listSignups('a1')).toEqual([
          signup('u1', '2026-11-14T10:00:00Z', {
            role: undefined,
            status: 'tentative',
            label: 'maybe',
          }),
        ]);
        expect(await s.listSignups('other')).toHaveLength(1);
      });

      it('deletes a signup', async () => {
        await s.upsertSignup(signup('u1', '2026-11-14T10:00:00Z'));
        await s.upsertSignup(signup('u2', '2026-11-14T11:00:00Z'));
        await s.deleteSignup('a1', 'u1');
        expect((await s.listSignups('a1')).map((x) => x.userId)).toEqual(['u2']);
      });
    });

    describe('jobs', () => {
      it('replaceJobs replaces earlier jobs for that activity only', async () => {
        const far = d('2030-01-01T00:00:00Z');
        await s.replaceJobs('a1', [{ activityId: 'a1', type: 'reminder', dueAt: far }]);
        await s.replaceJobs('a2', [{ activityId: 'a2', type: 'expire', dueAt: far }]);
        await s.replaceJobs('a1', [
          { activityId: 'a1', type: 'finish', dueAt: far },
          { activityId: 'a1', type: 'expire', dueAt: far },
        ]);
        const jobs = await s.dueJobs(far);
        expect(
          jobs.map((j) => `${j.activityId}:${j.type}`).sort((x, y) => x.localeCompare(y)),
        ).toEqual(['a1:expire', 'a1:finish', 'a2:expire']);
        expect(new Set(jobs.map((j) => j.id)).size).toBe(3);
      });

      it('dueJobs returns only jobs with dueAt <= now', async () => {
        await s.replaceJobs('a1', [
          { activityId: 'a1', type: 'reminder', dueAt: d('2026-11-14T11:00:00Z') },
          { activityId: 'a1', type: 'finish', dueAt: d('2026-11-14T12:00:00Z') },
          { activityId: 'a1', type: 'expire', dueAt: d('2026-11-14T12:00:01Z') },
        ]);
        const jobs = await s.dueJobs(d('2026-11-14T12:00:00Z'));
        expect(jobs.map((j) => j.type).sort((x, y) => x.localeCompare(y))).toEqual([
          'finish',
          'reminder',
        ]);
        expect(jobs.find((j) => j.type === 'reminder')!.dueAt).toEqual(d('2026-11-14T11:00:00Z'));
      });

      it('deleteJob removes one job', async () => {
        const due = d('2026-11-14T11:00:00Z');
        await s.replaceJobs('a1', [
          { activityId: 'a1', type: 'reminder', dueAt: due },
          { activityId: 'a1', type: 'finish', dueAt: due },
        ]);
        const [first] = await s.dueJobs(due);
        await s.deleteJob(first!.id);
        const rest = await s.dueJobs(due);
        expect(rest).toHaveLength(1);
        expect(rest[0]!.id).not.toBe(first!.id);
      });
    });

    describe('job edge cases', () => {
      it('deleteJob on an unknown id does not throw', async () => {
        await expect(s.deleteJob('999')).resolves.toBeUndefined();
      });
    });

    describe('templates', () => {
      it('round-trips, updates and filters by kind', async () => {
        expect(await s.getTemplate('t1')).toBeNull();
        await s.insertTemplate(template('t1', 'dungeon'));
        await s.insertTemplate(template('t2', 'raid'));
        await s.insertTemplate({ ...template('t3', 'raid'), guildId: 'g2' });
        expect(await s.getTemplate('t1')).toEqual(template('t1', 'dungeon'));

        const updated = { ...template('t2', 'raid'), enabled: false, reminderOffsetsMin: [30] };
        await s.updateTemplate(updated);
        expect(await s.getTemplate('t2')).toEqual(updated);

        expect((await s.listTemplates('g1')).map((t) => t.id).sort()).toEqual(['t1', 't2']);
        expect((await s.listTemplates('g1', 'raid')).map((t) => t.id)).toEqual(['t2']);
        expect((await s.listTemplates('g1', 'dungeon')).map((t) => t.id)).toEqual(['t1']);
      });
    });

    describe('config', () => {
      it('round-trips a guild config', async () => {
        expect(await s.getConfig('g1')).toBeNull();
        const c: GuildConfig = {
          guildId: 'g1',
          channels: { dungeon: 'c1', raid: 'c2' },
          officerRoleIds: ['r1', 'r2'],
          hostRoleIds: { raid: ['r3'] },
          reminders: { dungeon: [15], raid: [1440, 60], event: [60] },
          timezone: 'Europe/Berlin',
        };
        await s.saveConfig(c);
        expect(await s.getConfig('g1')).toEqual(c);
        const changed = { ...c, timezone: 'UTC' };
        await s.saveConfig(changed);
        expect(await s.getConfig('g1')).toEqual(changed);
      });
    });

    describe('members and characters', () => {
      it('round-trips members and finds them by Battle.net id', async () => {
        expect(await s.getMember('u1')).toBeNull();
        await s.saveMember({ userId: 'u1', battleNetId: 42, mainCharacterId: 'c1' });
        await s.saveMember({ userId: 'u2' });
        expect(await s.getMember('u1')).toEqual({
          userId: 'u1',
          battleNetId: 42,
          mainCharacterId: 'c1',
        });
        expect(await s.findMemberByBattleNet(42)).toEqual(await s.getMember('u1'));
        expect(await s.findMemberByBattleNet(43)).toBeNull();
      });

      it('saves, lists and deletes characters per user', async () => {
        await s.saveCharacter(character('c1', 'u1'));
        await s.saveCharacter(character('c2', 'u1'));
        await s.saveCharacter(character('c3', 'u2'));
        await s.saveCharacter({ ...character('c1', 'u1'), level: 70 });
        const mine = await s.listCharacters('u1');
        expect(mine.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
        expect(mine.find((c) => c.id === 'c1')!.level).toBe(70);
        await s.deleteCharacter('c2');
        expect((await s.listCharacters('u1')).map((c) => c.id)).toEqual(['c1']);
      });

      it('round-trips characters with all optional fields', async () => {
        const c: Character = {
          ...character('c1', 'u1'),
          blizzardId: 77,
          surname: 'Stormrage',
          race: 'Orc',
          faction: 'Horde',
          source: 'linked',
        };
        await s.saveCharacter(c);
        expect(await s.listCharacters('u1')).toEqual([c]);
      });

      it('deleteMember removes the member and their characters only', async () => {
        await s.saveMember({ userId: 'u1' });
        await s.saveMember({ userId: 'u2' });
        await s.saveCharacter(character('c1', 'u1'));
        await s.saveCharacter(character('c2', 'u2'));
        await s.deleteMember('u1');
        expect(await s.getMember('u1')).toBeNull();
        expect(await s.listCharacters('u1')).toEqual([]);
        expect(await s.getMember('u2')).not.toBeNull();
        expect(await s.listCharacters('u2')).toHaveLength(1);
      });
    });

    describe('link tokens', () => {
      const token = { token: 'abc', userId: 'u1', expiresAt: d('2026-11-14T12:10:00Z') };

      it('returns the token once, then null', async () => {
        await s.insertLinkToken(token);
        expect(await s.takeLinkToken('abc', d('2026-11-14T12:00:00Z'))).toEqual(token);
        expect(await s.takeLinkToken('abc', d('2026-11-14T12:00:01Z'))).toBeNull();
      });

      it('returns null for an unknown token', async () => {
        expect(await s.takeLinkToken('nope', d('2026-11-14T12:00:00Z'))).toBeNull();
      });

      it('accepts a token exactly at its expiry', async () => {
        await s.insertLinkToken(token);
        expect(await s.takeLinkToken('abc', token.expiresAt)).toEqual(token);
      });

      it('removes an expired token when it is looked up', async () => {
        await s.insertLinkToken(token);
        expect(await s.takeLinkToken('abc', d('2026-11-14T12:10:01Z'))).toBeNull();
        expect(await s.takeLinkToken('abc', d('2026-11-14T12:00:00Z'))).toBeNull();
      });

      it('returns null when expired', async () => {
        await s.insertLinkToken(token);
        expect(await s.takeLinkToken('abc', d('2026-11-14T12:10:01Z'))).toBeNull();
      });
    });
  });
}
