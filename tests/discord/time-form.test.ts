import { describe, expect, it } from 'vitest';
import { UserError } from '../../src/core/types.js';
import { dayOptions, halfHourOptions, timeFromForm } from '../../src/discord/time-form.js';

// Saturday 14 November 2026, 13:00 in Berlin.
const now = new Date('2026-11-14T12:00:00Z');
const tz = 'Europe/Berlin';

describe('dayOptions', () => {
  it('lists asap, flexible and the next 14 days', () => {
    const options = dayOptions(now, tz, true);
    expect(options).toHaveLength(16);
    expect(options.slice(0, 4)).toEqual([
      { label: 'As soon as possible', value: 'asap' },
      { label: 'Flexible (time to be agreed)', value: 'flexible' },
      { label: 'Today · Sat 14 Nov', value: '2026-11-14' },
      { label: 'Tomorrow · Sun 15 Nov', value: '2026-11-15' },
    ]);
    expect(options[4]).toEqual({ label: 'Mon 16 Nov', value: '2026-11-16' });
    expect(options[15]?.value).toBe('2026-11-27');
  });

  it('lists only days when a date is required', () => {
    const options = dayOptions(now, tz, false);
    expect(options).toHaveLength(14);
    expect(options[0]?.value).toBe('2026-11-14');
  });

  it('uses the server timezone for today', () => {
    // 23:30 UTC on the 14th is already the 15th in Berlin.
    const late = new Date('2026-11-14T23:30:00Z');
    expect(dayOptions(late, tz, false)[0]).toEqual({
      label: 'Today · Sun 15 Nov',
      value: '2026-11-15',
    });
  });
});

describe('halfHourOptions', () => {
  it('lists 12:00 to 23:30 in 30-minute steps', () => {
    const values = halfHourOptions().map((o) => o.value);
    expect(values).toHaveLength(24);
    expect(values[0]).toBe('12:00');
    expect(values[1]).toBe('12:30');
    expect(values[23]).toBe('23:30');
  });
});

describe('timeFromForm', () => {
  it('ignores the time for asap and flexible', () => {
    expect(timeFromForm('asap', '20:30', tz)).toEqual({ type: 'asap' });
    expect(timeFromForm('flexible', '20:30', tz)).toEqual({ type: 'flexible' });
  });

  it('reads a day and a time in the server timezone', () => {
    expect(timeFromForm('2026-11-20', '19:15', tz)).toEqual({
      type: 'at',
      at: new Date('2026-11-20T18:15:00Z'),
    });
  });

  it('refuses values that are not from the lists', () => {
    expect(() => timeFromForm('someday', '19:00', tz)).toThrow(UserError);
    expect(() => timeFromForm('2026-11-20', '25:00', tz)).toThrow(UserError);
  });
});
