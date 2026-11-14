import type { BotModule } from '../discord/registry.js';
import { signupButtons } from '../discord/signup-buttons.js';
import { admin } from './admin.js';
import { dungeons } from './dungeons.js';
import { events } from './events.js';
import { profiles } from './profiles.js';
import { raids } from './raids.js';

/**
 * The single place a feature is registered: main.ts routes interactions to these modules and
 * register-commands.ts registers their slash commands. This is a registration list, not a
 * module, and the only file that imports all modules.
 */
export const modules: BotModule[] = [signupButtons, dungeons, raids, events, profiles, admin];
