import { REST, Routes } from 'discord.js';
import { loadEnv } from './env.js';
import { log } from './log.js';
import { modules } from './modules/index.js';

// Guild commands (not global ones), so a change shows up in the server immediately.
const env = loadEnv(process.env);
const commands = modules.flatMap((m) => m.commands);
await new REST()
  .setToken(env.DISCORD_TOKEN)
  .put(Routes.applicationGuildCommands(env.DISCORD_APP_ID, env.GUILD_ID), { body: commands });
log.info('Slash commands registered', {
  guildId: env.GUILD_ID,
  commands: commands.map((c) => c.name),
});
