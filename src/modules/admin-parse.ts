import { UserError } from '../core/types.js';

/** "24h, 1h, 15m" -> [1440, 60, 15] (minutes, unique, largest first). */
export function parseOffsets(input: string): number[] {
  const minutes = input.split(',').map((part) => {
    const m = /^(\d+)([hm])$/i.exec(part.trim());
    const n = m ? Number(m[1]) * (m[2].toLowerCase() === 'h' ? 60 : 1) : 0;
    if (n < 1) {
      throw new UserError('Write reminder offsets like "24h, 1h, 15m".');
    }
    return n;
  });
  return [...new Set(minutes)].sort((a, b) => b - a);
}

/** [1440, 60, 15] -> "24h, 1h, 15m". */
export function formatOffsets(offsets: number[]): string {
  if (offsets.length === 0) return 'none';
  return offsets.map((m) => (m % 60 === 0 ? `${m / 60}h` : `${m}m`)).join(', ');
}
