import { z } from 'zod';

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1),
  GUILD_ID: z.string().min(1),
  DATABASE_PATH: z.string().min(1).default('data/bot.sqlite'),
  PUBLIC_URL: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  PORT: z.coerce.number().int().min(1).max(65535).default(3050),
  BLIZZARD_CLIENT_ID: z.string().min(1),
  BLIZZARD_CLIENT_SECRET: z.string().min(1),
  BLIZZARD_REGION: z.enum(['eu', 'us', 'kr', 'tw']).default('eu'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  throw new Error(`Invalid environment, check: ${names.join(', ')}`);
}
