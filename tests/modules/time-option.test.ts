import { describe, expect, it } from 'vitest';
import { UserError } from '../../src/core/types.js';
import { resolveTimeOption } from '../../src/modules/shared-options.js';

const now = new Date('2026-11-14T12:00:00Z');
const tz = 'Europe/Berlin';

describe('resolveTimeOption', () => {
  it('treats a missing option as as soon as possible', () => {
    expect(resolveTimeOption(null, now, tz)).toEqual({ type: 'asap' });
  });

  it('accepts asap in any case', () => {
    expect(resolveTimeOption('asap', now, tz)).toEqual({ type: 'asap' });
    expect(resolveTimeOption(' ASAP ', now, tz)).toEqual({ type: 'asap' });
  });

  it('accepts flexible', () => {
    expect(resolveTimeOption('flexible', now, tz)).toEqual({ type: 'flexible' });
    expect(resolveTimeOption('Flexible', now, tz)).toEqual({ type: 'flexible' });
  });

  it('reads today and tomorrow in the guild timezone', () => {
    expect(resolveTimeOption('tomorrow 19:00', now, tz)).toEqual({
      type: 'at',
      at: new Date('2026-11-15T18:00:00Z'),
    });
  });

  it('reads a date and time in the guild timezone', () => {
    expect(resolveTimeOption('2026-11-20 19:00', now, tz)).toEqual({
      type: 'at',
      at: new Date('2026-11-20T18:00:00Z'),
    });
  });

  it('rejects anything else with examples', () => {
    expect(() => resolveTimeOption('friday evening', now, tz)).toThrow(UserError);
    expect(() => resolveTimeOption('friday evening', now, tz)).toThrow(
      'I could not read that time. Try "today 20:30", "tomorrow 19:00", "2026-11-20 19:00", "asap" or "flexible".',
    );
  });
});
