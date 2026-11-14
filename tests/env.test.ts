import { expect, test } from 'vitest';
import { loadEnv } from '../src/env.js';

const valid = {
  DISCORD_TOKEN: 't',
  DISCORD_APP_ID: 'a',
  GUILD_ID: 'g',
  PUBLIC_URL: 'https://bot.example.org',
  BLIZZARD_CLIENT_ID: 'id',
  BLIZZARD_CLIENT_SECRET: 'secret',
};

test('loads a complete environment with defaults', () => {
  const env = loadEnv(valid);
  expect(env.PORT).toBe(3050);
  expect(env.BLIZZARD_REGION).toBe('eu');
  expect(env.DATABASE_PATH).toBe('data/bot.sqlite');
});

test('names every missing variable', () => {
  expect(() => loadEnv({})).toThrow(/DISCORD_TOKEN.*BLIZZARD_CLIENT_SECRET/s);
});

test('strips a trailing slash from PUBLIC_URL', () => {
  expect(loadEnv({ ...valid, PUBLIC_URL: 'https://x.org/' }).PUBLIC_URL).toBe('https://x.org');
});
