import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { createBlizzardClient } from './blizzard/client.js';
import { ActivityService } from './core/activities.js';
import { ConfigService } from './core/config.js';
import type { Clock } from './core/ports.js';
import { ProfileService } from './core/profiles.js';
import { TemplateService } from './core/templates.js';
import { createPublisher } from './discord/effects.js';
import { createRouter } from './discord/registry.js';
import { loadEnv } from './env.js';
import { log } from './log.js';
import { modules } from './modules/index.js';
import { notifyLinked } from './modules/profiles.js';
import { Scheduler } from './scheduler.js';
import { SqliteStorage } from './storage/sqlite.js';
import { createWebServer } from './web/server.js';

// src/ (tsx) and dist/ (node) both sit next to seed/, so one relative path serves both.
const SEED_FILE = new URL('../seed/templates.json', import.meta.url);

process.on('unhandledRejection', (err) => log.error('Unhandled promise rejection', { err }));
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception, exiting', { err });
  process.exit(1);
});

const env = loadEnv(process.env);
const clock: Clock = { now: () => new Date() };

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
const storage = new SqliteStorage(env.DATABASE_PATH);
const config = new ConfigService(storage);
const templates = new TemplateService(storage, config);
// The only ActivityService in the process: its queue keeps two simultaneous clicks from
// overfilling a slot.
const activities = new ActivityService({ storage, clock });
const profiles = new ProfileService({ storage, clock });

const added = await templates.seed(env.GUILD_ID, JSON.parse(readFileSync(SEED_FILE, 'utf8')));
log.info('Templates seeded', { added });

// Direct messages to members go through the REST API and need no intent.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const publish = createPublisher(client, activities, config);
const route = createRouter(modules, {
  activities,
  templates,
  config,
  profiles,
  publish,
  env,
  clock,
});
client.on(Events.InteractionCreate, (i) => void route(i));
client.on(Events.Error, (err) => log.error('Discord client error', { err }));

const scheduler = new Scheduler({ storage, clock, activities, onResult: publish });
client.once(Events.ClientReady, (ready) => {
  log.info('Discord client ready', { user: ready.user.tag });
  scheduler.start();
});

const web = createWebServer({
  profiles,
  blizzard: createBlizzardClient({
    clientId: env.BLIZZARD_CLIENT_ID,
    clientSecret: env.BLIZZARD_CLIENT_SECRET,
    region: env.BLIZZARD_REGION,
    redirectUri: `${env.PUBLIC_URL}/callback`,
  }),
  onLinked: notifyLinked(client),
});
web.listen(env.PORT, () => log.info('Web server listening', { port: env.PORT }));

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  log.info('Shutting down', { signal });
  scheduler.stop();
  await new Promise<void>((resolve) => web.close(() => resolve()));
  await client.destroy();
  storage.close();
  process.exit(0);
}
process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));

try {
  await client.login(env.DISCORD_TOKEN);
} catch (err) {
  log.error('Discord login failed; check DISCORD_TOKEN', { err });
  process.exit(1);
}
