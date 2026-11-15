import { describe, expect, it } from 'vitest';
import { ConfigService } from '../../src/core/config.js';
import { UserError } from '../../src/core/types.js';
import { MemoryStorage } from '../../src/storage/memory.js';

function setup() {
  return new ConfigService(new MemoryStorage());
}

describe('ConfigService', () => {
  it('returns defaults when nothing is saved', async () => {
    const cfg = setup();
    const c = await cfg.get('g');
    expect(c.reminders.raid).toEqual([1440, 60]);
    expect(c.reminders.dungeon).toEqual([15]);
    expect(c.reminders.event).toEqual([60]);
    expect(c.timezone).toBe('Europe/Berlin');
  });

  it('isOfficer: admin with no roles configured', async () => {
    const cfg = setup();
    expect(await cfg.isOfficer('g', { roleIds: [], isAdmin: true })).toBe(true);
    expect(await cfg.isOfficer('g', { roleIds: ['r1'], isAdmin: false })).toBe(false);
  });

  it('isOfficer: configured role', async () => {
    const cfg = setup();
    await cfg.update('g', { officerRoleIds: ['r1'] });
    expect(await cfg.isOfficer('g', { roleIds: ['r1'], isAdmin: false })).toBe(true);
    expect(await cfg.isOfficer('g', { roleIds: ['r2'], isAdmin: false })).toBe(false);
  });

  it('canHost: without host roles anyone hosts dungeons and events, officers host raids', async () => {
    const cfg = setup();
    const member = { roleIds: ['r1'], isAdmin: false };
    expect(await cfg.canHost('g', 'dungeon', member)).toBe(true);
    expect(await cfg.canHost('g', 'event', member)).toBe(true);
    expect(await cfg.canHost('g', 'raid', member)).toBe(false);
    expect(await cfg.canHost('g', 'raid', { roleIds: [], isAdmin: true })).toBe(true);
  });

  it('canHost: a kind with host roles is for those roles and officers', async () => {
    const cfg = setup();
    await cfg.update('g', {
      officerRoleIds: ['officer'],
      hostRoleIds: { raid: ['lead'], event: ['planner'] },
    });
    const has = (role: string) => ({ roleIds: [role], isAdmin: false });
    expect(await cfg.canHost('g', 'raid', has('lead'))).toBe(true);
    expect(await cfg.canHost('g', 'raid', has('planner'))).toBe(false);
    expect(await cfg.canHost('g', 'event', has('lead'))).toBe(false);
    expect(await cfg.canHost('g', 'event', has('officer'))).toBe(true);
    expect(await cfg.canHost('g', 'dungeon', has('nobody'))).toBe(true);
  });

  it('update persists and merges', async () => {
    const cfg = setup();
    await cfg.update('g', { timezone: 'America/New_York' });
    const c = await cfg.update('g', { channels: { raid: 'c1' } });
    expect(c.timezone).toBe('America/New_York');
    expect(c.channels.raid).toBe('c1');
    expect((await cfg.get('g')).channels.raid).toBe('c1');
  });

  it('rejects an invalid timezone', async () => {
    await expect(setup().update('g', { timezone: 'Mars/Phobos' })).rejects.toBeInstanceOf(
      UserError,
    );
  });

  it('rejects invalid reminder offsets', async () => {
    const cfg = setup();
    const bad = [0, -5, 1.5];
    for (const b of bad) {
      await expect(
        cfg.update('g', { reminders: { dungeon: [b], raid: [60], event: [60] } }),
      ).rejects.toBeInstanceOf(UserError);
    }
  });
});
