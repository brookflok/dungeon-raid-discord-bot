import { describe, expect, it } from 'vitest';
import type { ActivityView } from '../../src/core/activities.js';
import type { Activity, Signup } from '../../src/core/types.js';
import { discordTime, renderActivity, renderLog } from '../../src/discord/render.js';

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

const card = (r: ReturnType<typeof renderActivity>) => r.embeds[0]!;
const body = (r: ReturnType<typeof renderActivity>) => card(r).description ?? '';

describe('renderActivity', () => {
  it('renders an open dungeon as a card with role sections and four buttons', () => {
    const r = renderActivity(view({}, [{ role: 'tank', label: 'Brook Flok, Priest 37' }]));
    expect(r.content).toBe('');
    expect(card(r).title).toBe('⚔️ Scarlet Monastery');
    expect(body(r)).toContain('🛡 **TANK** 1/1\n　Brook Flok, Priest 37');
    expect(body(r)).toContain('💚 **HEALER** 0/1\n　*open*');
    expect(body(r)).toContain('Started by <@u1>');
    expect(buttonIds(r)).toEqual([
      'act:a1:tank',
      'act:a1:healer',
      'act:a1:dps',
      'act:a1:leave',
      'finish:a1',
    ]);
  });

  it('shows progress and the roles still needed', () => {
    const r = renderActivity(
      view({}, [{ role: 'tank' }, { role: 'dps' }, { role: 'dps', status: 'waitlist' }]),
    );
    expect(body(r)).toContain('**2/5** · needs Healer, DPS');
    expect(body(r)).toContain('▰▰▰▰▰▱▱▱▱▱▱▱');
  });

  it('says full when every slot is taken', () => {
    const r = renderActivity(
      view({ slots: { tank: 1, dps: 1 }, state: 'full' }, [{ role: 'tank' }, { role: 'dps' }]),
    );
    expect(body(r)).toContain('▰▰▰▰▰▰▰▰▰▰▰▰ **2/2** · full');
    expect(body(r)).toContain('🛡 **TANK** 1/1');
  });

  it('shows the waitlist only when someone is on it', () => {
    expect(body(renderActivity(view({})))).not.toContain('WAITLIST');
    const r = renderActivity(view({}, [{ role: 'dps', status: 'waitlist', label: 'Late Mage' }]));
    expect(body(r)).toContain('⏳ **WAITLIST** 1\n　Late Mage');
  });

  it('adds Tentative and Can’t come for raids', () => {
    const r = renderActivity(
      view(
        {
          kind: 'raid',
          time: { type: 'at', at: new Date('2026-11-20T18:00:00Z') },
          slots: { tank: 2, healer: 5, dps: 13 },
          reminderOffsetsMin: [1440, 60],
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
      'finish:a1',
    ]);
    expect(body(r)).toContain('❔ **TENTATIVE** 1\n　Maybe Mage');
    expect(card(r).footer?.text).toBe('Raid · reminder 1 d and 1 h before');
    expect(r.components.every((row) => row.components.length <= 5)).toBe(true);
  });

  it('shows Join and a head count for an unlimited event', () => {
    const r = renderActivity(
      view({ kind: 'event', title: 'Fishing contest', slots: { participant: null } }, [
        { role: 'participant' },
      ]),
    );
    expect(buttonLabels(r)).toEqual(['Join', 'Leave', 'Finish']);
    expect(buttonIds(r)).toEqual(['act:a1:participant', 'act:a1:leave', 'finish:a1']);
    expect(body(r)).toContain('👥 **1** coming');
    expect(body(r)).toContain('1/∞');
  });

  it('shows the status in the title, turns grey and drops the buttons once cancelled', () => {
    const r = renderActivity(view({ state: 'cancelled' }));
    expect(r.components).toEqual([]);
    expect(card(r).title).toBe('⚔️ Scarlet Monastery — 🚫 Cancelled');
    expect(card(r).color).toBe(0x6b7280);
  });

  it('escapes labels and the title so they cannot mention or format', () => {
    const r = renderActivity(
      view({ title: '**Bold** @here' }, [{ role: 'dps', label: '@everyone **x**' }]),
    );
    expect(body(r)).not.toContain('@everyone');
    expect(body(r)).not.toContain('**x**');
    expect(card(r).title).not.toContain('**Bold**');
    expect(card(r).title).not.toContain('@here');
  });

  it('escapes masked links and headings', () => {
    const r = renderActivity(
      view({ kind: 'event', slots: { participant: null }, description: '# Big' }, [
        { role: 'participant', label: '[Free gold](https://x.yz)' },
      ]),
    );
    expect(body(r)).toContain('\\[Free gold](https://x.yz)');
    expect(body(r)).toContain('\\# Big');
  });

  it('renders 2000 signups within 100 ms and 4096 characters', () => {
    const signups = Array.from({ length: 2000 }, (_, n) => ({
      role: 'participant' as const,
      label: `Member ${n + 1}, Warrior 60`,
    }));
    const v = view({ kind: 'event', slots: { participant: null } }, signups);
    const start = performance.now();
    const r = renderActivity(v);
    expect(performance.now() - start).toBeLessThan(100);
    expect(body(r).length).toBeLessThanOrEqual(4096);
    expect(body(r)).toContain('more');
  });

  it('keeps a 40-member raid complete', () => {
    const signups = Array.from({ length: 40 }, (_, n) => ({
      role: 'dps' as const,
      label: `Member ${n + 1} Surname, Warrior 60`,
    }));
    const r = renderActivity(view({ kind: 'raid', slots: { dps: 40 } }, signups));
    expect(body(r)).toContain('Member 40 Surname');
    expect(body(r)).not.toContain('more');
  });
});

describe('a finished activity', () => {
  it('shows the reported result in the title of the post', () => {
    const r = renderActivity(view({ state: 'finished', outcome: 'failed' }));
    expect(r.embeds[0]?.title).toBe('⚔️ Scarlet Monastery — ❌ Failed');
    expect(r.components).toEqual([]);
  });
});

describe('renderLog', () => {
  const signups = [
    { role: 'dps' as const, label: 'Lyra, Mage 22' },
    { role: 'tank' as const, label: 'Thorin, Warrior 24' },
    { role: 'dps' as const, status: 'waitlist' as const, label: 'Late' },
  ];

  it('shows the result, the members by role and the report', () => {
    const r = renderLog(
      view({ state: 'finished', outcome: 'completed', report: 'Clean **run**.' }, signups),
    );
    const card = r.embeds[0]!;
    expect(card.title).toBe('✅ Scarlet Monastery — Completed');
    expect(card.color).toBe(0x22c55e);
    expect(card.description).toContain('🛡 Thorin, Warrior 24\n🗡 Lyra, Mage 22');
    expect(card.description).not.toContain('Late');
    expect(card.description).toContain('📝 **Report**\nClean \\*\\*run\\*\\*.');
    expect(r.content).toBe('');
    expect(r.components).toEqual([]);
    expect(r.allowedMentions).toEqual({ users: [] });
  });

  it('without a result mentions the starter and offers the Add result button', () => {
    const r = renderLog(view({ state: 'finished' }, signups));
    expect(r.embeds[0]?.title).toBe('❔ Scarlet Monastery — No result reported');
    expect(r.content).toContain('<@u1>');
    expect(r.allowedMentions).toEqual({ users: ['u1'] });
    expect(r.components[0]?.components.map((c) => [c.customId, c.label])).toEqual([
      ['finish:a1', 'Add result'],
    ]);
  });

  it('shows the start time of a timed activity and says when nobody signed up', () => {
    const r = renderLog(
      view({
        state: 'finished',
        outcome: 'not_happened',
        time: { type: 'at', at: new Date('2026-11-14T19:30:00Z') },
      }),
    );
    expect(r.embeds[0]?.title).toBe('🚫 Scarlet Monastery — Did not happen');
    expect(r.embeds[0]?.description).toContain('🕐 <t:1794684600:F>');
    expect(r.embeds[0]?.description).toContain('Nobody signed up.');
  });
});

describe('discordTime', () => {
  it('formats full and relative Discord timestamps', () => {
    expect(discordTime(new Date('2026-11-14T19:30:00Z'))).toBe(
      '<t:1794684600:F> (<t:1794684600:R>)',
    );
  });
});
