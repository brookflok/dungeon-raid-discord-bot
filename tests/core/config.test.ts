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
