import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
  type SlashCommandStringOption,
} from 'discord.js';
import type { Kind, Slots, Template } from '../core/types.js';
import { UserError, type GuildConfig } from '../core/types.js';
import { notice } from '../discord/notice.js';
import { panel } from '../discord/panel.js';
import { actorOf, type BotModule, type Services } from '../discord/registry.js';
import { log } from '../log.js';
import { formatOffsets, parseOffsets } from './admin-parse.js';

const KINDS: Kind[] = ['dungeon', 'raid', 'event'];
// log: the channel finished activities are moved to.
const CHANNEL_KINDS: (Kind | 'log')[] = [...KINDS, 'log'];
const TEMPLATE_KINDS: ('dungeon' | 'raid')[] = ['dungeon', 'raid'];
const SLOT_ROLES = ['tank', 'healer', 'dps'] as const;

const kindOption = (kinds: string[]) => (o: SlashCommandStringOption) =>
  o
    .setName('kind')
    .setDescription('Activity kind')
    .setRequired(true)
    .addChoices(kinds.map((k) => ({ name: k, value: k })));

function slotOptions(c: SlashCommandSubcommandBuilder, required: boolean) {
  for (const role of SLOT_ROLES) {
    c.addIntegerOption((o) =>
      o
        .setName(role)
        .setDescription(`Number of ${role} slots`)
        .setMinValue(0)
        .setRequired(required),
    );
  }
  return c;
}

const remindersOption = (o: SlashCommandStringOption) =>
  o.setName('reminders').setDescription('Reminder offsets like "24h, 1h, 15m"');

const templateOption = (o: SlashCommandStringOption) =>
  o.setName('template').setDescription('Which template').setRequired(true).setAutocomplete(true);

function describeConfig(c: GuildConfig): string {
  const channels = CHANNEL_KINDS.map(
    (k) => `${k}: ${c.channels[k] ? `<#${c.channels[k]}>` : 'not set'}`,
  ).join('; ');
  const roles = c.officerRoleIds.length
    ? c.officerRoleIds.map((r) => `<@&${r}>`).join(', ')
    : 'none';
  const hosts = KINDS.map((k) => {
    const ids = c.hostRoleIds[k] ?? [];
    const who = ids.length
      ? ids.map((r) => `<@&${r}>`).join(', ')
      : k === 'raid'
        ? 'officers'
        : 'everyone';
    return `${k}: ${who}`;
  }).join('; ');
  const reminders = KINDS.map((k) => `${k}: ${formatOffsets(c.reminders[k])}`).join('; ');
  return [
    `Post channels - ${channels}`,
    `Officer roles - ${roles} (server administrators are always officers)`,
    `Hosts - ${hosts} (officers can always host)`,
    `Reminders - ${reminders}`,
    `Timezone - ${c.timezone}`,
  ].join('\n');
}

function describeTemplate(t: Template): string {
  const slots = SLOT_ROLES.map((r) => `${t.slots[r] ?? 0} ${r}`).join(', ');
  const reminders = t.reminderOffsetsMin ? formatOffsets(t.reminderOffsetsMin) : 'kind default';
  return `${t.name} (${t.kind}): ${slots}; reminders: ${reminders}; ${t.enabled ? 'enabled' : 'disabled'}`;
}

async function allTemplates(s: Services, guildId: string): Promise<Template[]> {
  const lists = await Promise.all(TEMPLATE_KINDS.map((k) => s.templates.listAll(guildId, k)));
  return lists.flat();
}

async function handleConfig(
  i: Parameters<NonNullable<BotModule['onCommand']>>[0],
  s: Services,
  guildId: string,
): Promise<void> {
  const sub = i.options.getSubcommand();
  if (sub === 'show') {
    await i.editReply(notice(describeConfig(await s.config.get(guildId))));
    return;
  }
  const current = await s.config.get(guildId);
  if (sub === 'panel') {
    const kind = i.options.getString('kind', true) as Kind | 'all';
    // The host panel has no channel of its own; it goes where the command is used.
    const channelId = kind === 'all' ? i.channelId : current.channels[kind];
    if (!channelId) throw new UserError(`Set the ${kind} channel first with /config channels.`);
    const channel = await i.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isSendable()) throw new UserError('I cannot send messages in that channel.');
    const message = await channel.send(panel(kind));
    // Pinning needs an extra permission; the panel works without it.
    await message.pin().catch((err: unknown) => log.error('pin panel', { err }));
    await i.editReply(notice(`The panel is posted in <#${channelId}>.`, 'ok'));
    return;
  }
  let next: GuildConfig;
  if (sub === 'channels') {
    const kind = i.options.getString('kind', true) as Kind | 'log';
    const channel = i.options.getChannel('channel', true);
    next = await s.config.update(guildId, {
      channels: { ...current.channels, [kind]: channel.id },
    });
  } else if (sub === 'officers') {
    const role = i.options.getRole('role', true).id;
    const has = current.officerRoleIds.includes(role);
    const add = i.options.getString('action', true) === 'add';
    next =
      add === has
        ? current
        : await s.config.update(guildId, {
            officerRoleIds: add
              ? [...current.officerRoleIds, role]
              : current.officerRoleIds.filter((r) => r !== role),
          });
  } else if (sub === 'hosts') {
    const kind = i.options.getString('kind', true) as Kind;
    const role = i.options.getRole('role', true).id;
    const roles = current.hostRoleIds[kind] ?? [];
    const add = i.options.getString('action', true) === 'add';
    next =
      add === roles.includes(role)
        ? current
        : await s.config.update(guildId, {
            hostRoleIds: {
              ...current.hostRoleIds,
              [kind]: add ? [...roles, role] : roles.filter((r) => r !== role),
            },
          });
  } else if (sub === 'reminders') {
    const kind = i.options.getString('kind', true) as Kind;
    const offsets = parseOffsets(i.options.getString('offsets', true));
    next = await s.config.update(guildId, { reminders: { ...current.reminders, [kind]: offsets } });
  } else {
    next = await s.config.update(guildId, { timezone: i.options.getString('zone', true).trim() });
  }
  await i.editReply(notice(describeConfig(next), 'ok', 'Saved'));
}

async function handleTemplate(
  i: Parameters<NonNullable<BotModule['onCommand']>>[0],
  s: Services,
  guildId: string,
): Promise<void> {
  const sub = i.options.getSubcommand();
  const reminders = i.options.getString('reminders');
  const reminderOffsetsMin = reminders === null ? undefined : parseOffsets(reminders);

  if (sub === 'list') {
    const kind = i.options.getString('kind', true) as 'dungeon' | 'raid';
    const all = await s.templates.listAll(guildId, kind);
    await i.editReply(
      notice(all.length ? all.map(describeTemplate).join('\n') : `There are no ${kind} templates.`),
    );
    return;
  }
  if (sub === 'add') {
    const slots: Slots = {};
    for (const role of SLOT_ROLES) slots[role] = i.options.getInteger(role, true);
    const t = await s.templates.add({
      guildId,
      kind: i.options.getString('kind', true) as 'dungeon' | 'raid',
      name: i.options.getString('name', true).trim(),
      slots,
      reminderOffsetsMin,
    });
    await i.editReply(notice(describeTemplate(t), 'ok', 'Added'));
    return;
  }

  const id = i.options.getString('template', true);
  if (sub === 'edit') {
    const patch: { name?: string; slots?: Slots; reminderOffsetsMin?: number[] } = {};
    const name = i.options.getString('name');
    if (name !== null) patch.name = name.trim();
    if (reminderOffsetsMin) patch.reminderOffsetsMin = reminderOffsetsMin;
    if (SLOT_ROLES.some((r) => i.options.getInteger(r) !== null)) {
      const existing = (await allTemplates(s, guildId)).find((t) => t.id === id);
      if (!existing) throw new UserError('Template not found.');
      patch.slots = { ...existing.slots };
      for (const role of SLOT_ROLES) {
        const n = i.options.getInteger(role);
        if (n !== null) patch.slots[role] = n;
      }
    }
    if (Object.keys(patch).length === 0) throw new UserError('Choose something to change.');
    await i.editReply(notice(describeTemplate(await s.templates.edit(id, patch)), 'ok', 'Saved'));
    return;
  }
  const t = await s.templates.setEnabled(id, sub === 'enable');
  await i.editReply(notice(describeTemplate(t), 'ok', 'Saved'));
}

export const admin: BotModule = {
  name: 'admin',
  commands: [
    new SlashCommandBuilder()
      .setName('config')
      .setDescription('Guild settings (officers only)')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((c) =>
        c
          .setName('channels')
          .setDescription('Choose the channel an activity kind posts in, or the log channel')
          .addStringOption(kindOption(CHANNEL_KINDS))
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Text channel')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText),
          ),
      )
      .addSubcommand((c) =>
        c
          .setName('officers')
          .setDescription('Add or remove an officer role')
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
          .addStringOption((o) =>
            o
              .setName('action')
              .setDescription('Add or remove')
              .setRequired(true)
              .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }),
          ),
      )
      .addSubcommand((c) =>
        c
          .setName('hosts')
          .setDescription('Add or remove a role that may host a kind (besides officers)')
          .addStringOption(kindOption(KINDS))
          .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
          .addStringOption((o) =>
            o
              .setName('action')
              .setDescription('Add or remove')
              .setRequired(true)
              .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }),
          ),
      )
      .addSubcommand((c) =>
        c
          .setName('reminders')
          .setDescription('Set default reminder offsets for a kind')
          .addStringOption(kindOption(KINDS))
          .addStringOption((o) =>
            o
              .setName('offsets')
              .setDescription('Offsets before the start, like "24h, 1h, 15m"')
              .setRequired(true),
          ),
      )
      .addSubcommand((c) =>
        c
          .setName('timezone')
          .setDescription('Set the timezone for typed times')
          .addStringOption((o) =>
            o.setName('zone').setDescription('For example Europe/Berlin').setRequired(true),
          ),
      )
      .addSubcommand((c) => c.setName('show').setDescription('Show the current settings'))
      .addSubcommand((c) =>
        c
          .setName('panel')
          .setDescription('Post a panel with buttons: one kind in its channel, or "all" right here')
          .addStringOption(kindOption([...KINDS, 'all'])),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('template')
      .setDescription('Dungeon and raid templates (officers only)')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((c) =>
        slotOptions(
          c
            .setName('add')
            .setDescription('Add a template')
            .addStringOption(kindOption(TEMPLATE_KINDS))
            .addStringOption((o) =>
              o.setName('name').setDescription('Name').setRequired(true).setMaxLength(100),
            ),
          true,
        ).addStringOption(remindersOption),
      )
      .addSubcommand((c) =>
        slotOptions(
          c
            .setName('edit')
            .setDescription('Change a template')
            .addStringOption(templateOption)
            .addStringOption((o) => o.setName('name').setDescription('New name').setMaxLength(100)),
          false,
        ).addStringOption(remindersOption),
      )
      .addSubcommand((c) =>
        c.setName('disable').setDescription('Hide a template').addStringOption(templateOption),
      )
      .addSubcommand((c) =>
        c.setName('enable').setDescription('Show a template again').addStringOption(templateOption),
      )
      .addSubcommand((c) =>
        c
          .setName('list')
          .setDescription('List templates, including disabled ones')
          .addStringOption(kindOption(TEMPLATE_KINDS)),
      )
      .toJSON(),
  ],

  async onAutocomplete(i, s) {
    let choices: { name: string; value: string }[] = [];
    try {
      const typed = i.options.getFocused().toLowerCase();
      choices = (await allTemplates(s, i.guildId!))
        .filter((t) => t.name.toLowerCase().includes(typed))
        .slice(0, 25)
        .map((t) => ({
          name: `${t.name} (${t.kind}${t.enabled ? '' : ', disabled'})`.slice(0, 100),
          value: t.id,
        }));
    } catch (err) {
      log.error('autocomplete failed', { err });
    }
    await i.respond(choices);
  },

  async onCommand(i, s) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const guildId = i.guildId!; // guild-only command
    const actor = await actorOf(i, s);
    if (!actor.isOfficer) throw new UserError('Only officers can change settings.');
    await (i.commandName === 'config' ? handleConfig : handleTemplate)(i, s, guildId);
  },
};
