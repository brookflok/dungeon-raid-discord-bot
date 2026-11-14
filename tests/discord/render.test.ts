import { describe, expect, it } from 'vitest';
import type { ActivityView } from '../../src/core/activities.js';
import type { Activity, Signup } from '../../src/core/types.js';
import { discordTime, renderActivity } from '../../src/discord/render.js';

const created = new Date('2026-11-14T12:00:00Z');

function view(activity: Partial<Activity>, signups: Partial<Signup>[] = []): ActivityView {
  return {
    activity: {
      id: 'a1',
      guildId: 'g1',
      kind: 'dungeon',
      title: 'Scarlet Monastery',
      starterId: 'u1',
      time: { type: 'asap' },
      slots: { tank: 1, healer: 1, dps: 3 },
      reminderOffsetsMin: [15],
      state: 'open',
      createdAt: created,
      ...activity,
    },
    signups: signups.map((s, n) => ({
      activityId: 'a1',
      userId: `u${n + 1}`,
      status: 'confirmed',
      label: `Member ${n + 1}`,
      createdAt: created,
      ...s,
    })),
  };
}

const buttonIds = (r: ReturnType<typeof renderActivity>) =>
  r.components.flatMap((row) => row.components.map((c) => c.customId));
const buttonLabels = (r: ReturnType<typeof renderActivity>) =>
  r.components.flatMap((row) => row.components.map((c) => c.label));

describe('renderActivity', () => {
  it('renders an open dungeon with role lines and four buttons', () => {
    const r = renderActivity(view({}, [{ role: 'tank', label: 'Brook Flok, Priest 37' }]));
    expect(r.content).toContain('🛡 Tank    1/1');
    expect(r.content).toContain('Brook Flok, Priest 37');
    expect(r.content).toContain('0/1');
    expect(r.content).toContain('started by <@u1>');
    expect(buttonIds(r)).toEqual(['act:a1:tank', 'act:a1:healer', 'act:a1:dps', 'act:a1:leave']);
  });

  it('adds Tentative and Can’t come for raids', () => {
    const r = renderActivity(
      view(
        {
          kind: 'raid',
          time: { type: 'at', at: new Date('2026-11-20T18:00:00Z') },
          slots: { tank: 2, healer: 5, dps: 13 },
        },
        [{ status: 'tentative', label: 'Maybe Mage' }],
      ),
    );
    expect(buttonIds(r)).toEqual([
      'act:a1:tank',
      'act:a1:healer',
      'act:a1:dps',
      'act:a1:tentative',
      'act:a1:absent',
      'act:a1:leave',
    ]);
    expect(r.content).toContain('Tentative');
    expect(r.content).toContain('Maybe Mage');
    expect(r.components.every((row) => row.components.length <= 5)).toBe(true);
  });

  it('shows Join and ∞ for an unlimited event', () => {
    const r = renderActivity(
      view({ kind: 'event', title: 'Fishing contest', slots: { participant: null } }),
    );
    expect(buttonLabels(r)).toEqual(['Join', 'Leave']);
    expect(buttonIds(r)).toEqual(['act:a1:participant', 'act:a1:leave']);
    expect(r.content).toContain('∞');
  });

  it('shows a status line and no buttons once cancelled', () => {
    const r = renderActivity(view({ state: 'cancelled' }));
    expect(r.components).toEqual([]);
    expect(r.content).toContain('Cancelled');
  });

  it('escapes labels so they cannot mention or format', () => {
    const r = renderActivity(view({}, [{ role: 'dps', label: '@everyone **x**' }]));
    expect(r.content).not.toContain('@everyone');
    expect(r.content).not.toContain('**x**');
  });

  it('stays within 2000 characters for 400 signups', () => {
    const signups = Array.from({ length: 400 }, (_, n) => ({
      role: 'participant' as const,
      label: `Member ${n + 1}, Warrior 60`,
    }));
    const r = renderActivity(view({ kind: 'event', slots: { participant: null } }, signups));
    expect(r.content.length).toBeLessThanOrEqual(2000);
    expect(r.content).toContain('more');
  });
});

describe('discordTime', () => {
  it('formats full and relative Discord timestamps', () => {
    expect(discordTime(new Date('2026-11-14T19:30:00Z'))).toBe(
      '<t:1794684600:F> (<t:1794684600:R>)',
    );
  });
});
