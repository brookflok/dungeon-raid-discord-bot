import { describe, expect, it } from 'vitest';
import { UserError } from '../../src/core/types.js';
import { formatOffsets, parseOffsets } from '../../src/modules/admin-parse.js';

describe('parseOffsets', () => {
  it('parses hours and minutes', () => {
    expect(parseOffsets('24h, 1h, 15m')).toEqual([1440, 60, 15]);
    expect(parseOffsets('90m')).toEqual([90]);
  });

  it('removes duplicates and sorts descending', () => {
    expect(parseOffsets('15m, 1h, 60m, 24h')).toEqual([1440, 60, 15]);
  });

  it.each(['', 'soon', '0m', '-5m', '1h,,2h', '1.5h'])('rejects "%s"', (input) => {
    expect(() => parseOffsets(input)).toThrow(UserError);
  });
});

describe('formatOffsets', () => {
  it('writes whole hours as hours and the rest as minutes', () => {
    expect(formatOffsets([1440, 60, 15, 90])).toBe('24h, 1h, 15m, 90m');
    expect(formatOffsets([])).toBe('none');
  });
});
