import type { MessageComponentInteraction, ModalBuilder, ModalSubmitInteraction } from 'discord.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityService, type ActivityResult } from '../../src/core/activities.js';
import { ConfigService } from '../../src/core/config.js';
import { ProfileService } from '../../src/core/profiles.js';
import { TemplateService } from '../../src/core/templates.js';
import type { Services } from '../../src/discord/registry.js';
import { finish } from '../../src/discord/finish.js';
import { manage } from '../../src/discord/manage.js';
import { mainMenu } from '../../src/discord/notify-linked.js';
import { panel } from '../../src/discord/panel.js';
import { dungeons } from '../../src/modules/dungeons.js';
import { events } from '../../src/modules/events.js';
import { profiles } from '../../src/modules/profiles.js';
import { raids } from '../../src/modules/raids.js';
import { MemoryStorage } from '../../src/storage/memory.js';

// Saturday 14 November 2026, 13:00 in Berlin.
const now = new Date('2026-11-14T12:00:00Z');

let s: Services;
let dungeonId: string;
let raidId: string;
let published: ActivityResult[];

beforeEach(async () => {
  member = admin;
  const storage = new MemoryStorage();
  const clock = { now: () => now };
  const config = new ConfigService(storage);
  const templates = new TemplateService(storage, config);
  const activities = new ActivityService({ storage, clock });
  published = [];
  s = {
    activities,
    templates,
    config,
    profiles: new ProfileService({ storage, clock }),
    clock,
    env: { PUBLIC_URL: 'https://bot.example.org' },
    publish: async (r: ActivityResult) => {
      published.push(r);
      if (!r.activity.messageId) {
        await activities.setPost(r.activity.id, { channelId: 'c1', messageId: 'm1' });
      }
    },
  } as unknown as Services;
  await config.update('g1', { channels: { dungeon: 'c1', raid: 'c1', event: 'c1' } });
  const slots = { tank: 1, healer: 1, dps: 3 };
  dungeonId = (await templates.add({ guildId: 'g1', kind: 'dungeon', name: 'Deadmines', slots }))
    .id;
  raidId = (await templates.add({ guildId: 'g1', kind: 'raid', name: 'Molten Core', slots })).id;
});

const admin = {
  guildId: 'g1',
  user: { id: 'u1', displayName: 'Damir' },
  member: { roles: [], displayName: 'Damir' },
  memberPermissions: { has: () => true },
  inCachedGuild: () => false,
};
let member = admin;
/** Acts as a member who is not an administrator and has these roles. */
const actAs = (...roles: string[]): void => {
  member = {
    ...admin,
    member: { ...admin.member, roles: roles as never[] },
    memberPermissions: { has: () => false },
  };
};

/** Clicks a button and returns the form it opened, as Discord would receive it. */
async function opened(
  module: typeof dungeons,
  args: string[] = [],
): Promise<ReturnType<ModalBuilder['toJSON']>> {
  let form: ModalBuilder | undefined;
  const i = { ...member, showModal: async (m: ModalBuilder) => void (form = m) };
  await module.onComponent!(i as unknown as MessageComponentInteraction, s, args);
  return form!.toJSON();
}

/** Submits a form with these values and returns the reply. */
async function submitted(
  module: typeof dungeons,
  values: Record<string, string | undefined>,
  args: string[] = [],
): Promise<{ embeds: { title?: string; description?: string }[]; components?: unknown[] }> {
  let reply: unknown;
  const i = {
    ...member,
    deferReply: async () => undefined,
    editReply: async (r: unknown) => void (reply = r),
    fields: {
      getStringSelectValues: (id: string) => (values[id] === undefined ? [] : [values[id]]),
      getTextInputValue: (id: string) => values[id] ?? '',
    },
  };
  await module.onModal!(i as unknown as ModalSubmitInteraction, s, args);
  return reply as Awaited<ReturnType<typeof submitted>>;
}

const fieldIds = (form: ReturnType<ModalBuilder['toJSON']>): string[] =>
  form.components.map((c) => (c as { component: { custom_id: string } }).component.custom_id);

describe('forms', () => {
  it('opens the dungeon form with five dropdowns, as soon as possible and 20:00 preselected', async () => {
    const form = await opened(dungeons);
    expect(form.custom_id).toBe('dungeon:start');
    expect(fieldIds(form)).toEqual(['dungeon', 'role', 'day', 'hour', 'minute']);
    const defaults = form.components.map((c) => {
      const { options } = (c as { component: { options: { value: string; default?: boolean }[] } })
        .component;
      return options.find((o) => o.default)?.value;
    });
    expect(defaults).toEqual([undefined, undefined, 'asap', '20', '00']);
  });

  it('opens the raid form without as soon as possible and with an optional own role', async () => {
    const form = await opened(raids);
    expect(fieldIds(form)).toEqual(['raid', 'day', 'hour', 'minute', 'signup']);
    const day = (form.components[1] as { component: { options: { value: string }[] } }).component;
    expect(day.options[0]?.value).toBe('2026-11-14');
    const signup = (form.components[4] as { component: { required?: boolean } }).component;
    expect(signup.required).toBe(false);
  });

  it('opens the event, change-time and add-character forms', async () => {
    expect(fieldIds(await opened(events))).toEqual(['title', 'description', 'day', 'time', 'max']);
    const { activity } = await s.activities.create({
      guildId: 'g1',
      kind: 'event',
      title: 'Fishing',
      starter: { userId: 'u1', label: 'Damir' },
      time: { type: 'asap' },
      slots: { participant: null },
      reminderOffsetsMin: [],
    });
    const time = await opened(manage, ['time', activity.id]);
    expect(time.custom_id).toBe(`manage:time:${activity.id}`);
    expect(fieldIds(time)).toEqual(['day', 'hour', 'minute']);
    const add = await opened(profiles, ['add', activity.id]);
    expect(add.custom_id).toBe(`profile:add:${activity.id}`);
    expect(fieldIds(add)).toEqual(['name', 'surname', 'class', 'level']);
  });

  it('builds a panel for every kind', () => {
    for (const kind of ['dungeon', 'raid', 'event'] as const) {
      const p = panel(kind);
      expect(p.embeds[0]?.title).toBeTruthy();
      expect(p.components).toHaveLength(2);
    }
  });

  it('builds the host panel with a button for every kind', () => {
    const p = panel('all');
    expect(p.embeds[0]?.title).toBe('🎮 Host an activity');
    expect(p.components[0]?.components.map((b) => 'customId' in b && b.customId)).toEqual([
      'dungeon:start',
      'raid:post',
      'event:post',
    ]);
  });
});

describe('host roles', () => {
  const raid = { raid: '', day: '2026-11-20', hour: '20', minute: '00' };

  it('lets any member host a dungeon or an event and refuses a raid', async () => {
    actAs();
    expect((await opened(dungeons)).custom_id).toBe('dungeon:start');
    expect((await opened(events)).custom_id).toBe('event:post');
    await expect(opened(raids)).rejects.toThrow('Only officers can host a raid.');
    await expect(submitted(raids, { ...raid, raid: raidId })).rejects.toThrow(
      'Only officers can host a raid.',
    );
  });

  it('lets a member with the raid host role post a raid', async () => {
    await s.config.update('g1', { hostRoleIds: { raid: ['lead'] } });
    actAs('lead');
    await opened(raids);
    await submitted(raids, { ...raid, raid: raidId });
    expect(published[0]!.activity.kind).toBe('raid');
  });

  it('refuses members without the host role of a kind, on the button and on the form', async () => {
    await s.config.update('g1', { hostRoleIds: { dungeon: ['member'], event: ['planner'] } });
    actAs('planner');
    const refusal = 'Only members with <@&member> and officers can host a dungeon.';
    await expect(opened(dungeons)).rejects.toThrow(refusal);
    await expect(
      submitted(dungeons, {
        dungeon: dungeonId,
        role: 'tank',
        day: 'asap',
        hour: '20',
        minute: '00',
      }),
    ).rejects.toThrow(refusal);
    expect((await opened(events)).custom_id).toBe('event:post');
    expect(published).toEqual([]);
  });
});

describe('dungeon form flow', () => {
  const pick = { dungeon: '', role: 'tank', day: '2026-11-20', hour: '19', minute: '15' };

  it('posts the group at the picked time and offers to add a character', async () => {
    const reply = await submitted(dungeons, { ...pick, dungeon: dungeonId });
    const { activity, signups } = published[0]!;
    expect(activity.title).toBe('Deadmines');
    expect(activity.time).toEqual({ type: 'at', at: new Date('2026-11-20T18:15:00Z') });
    expect(signups.map((x) => [x.role, x.label])).toEqual([['tank', 'Damir']]);
    expect(reply.embeds[0]?.title).toBe('✅ Your group is posted');
    expect(reply.embeds[0]?.description).toContain('Link your Battle.net account');
    expect(JSON.stringify(reply.components)).toContain(`profile:add:${activity.id}`);
    expect(JSON.stringify(reply.components)).toContain(`manage:cancel:${activity.id}`);
  });

  it('shows the character on the post after "Add by name", keeping the role', async () => {
    await submitted(dungeons, { ...pick, dungeon: dungeonId });
    const { id } = published[0]!.activity;
    await submitted(profiles, { name: 'Thorin', surname: '', class: 'Warrior', level: '24' }, [
      'add',
      id,
    ]);
    const { signups } = (await s.activities.get(id))!;
    expect(signups.map((x) => [x.role, x.status, x.label])).toEqual([
      ['tank', 'confirmed', 'Thorin, Warrior 24'],
    ]);
    expect(published).toHaveLength(2);
  });

  it('does not offer a character to a member who has one', async () => {
    await s.profiles.addManual('u1', { name: 'Thorin', className: 'Warrior', level: 24 });
    const reply = await submitted(dungeons, { ...pick, dungeon: dungeonId, day: 'asap' });
    expect(published[0]!.activity.time).toEqual({ type: 'asap' });
    expect(reply.embeds[0]?.description).not.toContain('Battle.net');
    expect(JSON.stringify(reply.components)).not.toContain('profile:add');
  });

  it('refuses a time in the past', async () => {
    await expect(
      submitted(dungeons, { ...pick, dungeon: dungeonId, day: '2026-11-14', hour: '09' }),
    ).rejects.toThrow('That time is in the past');
  });
});

describe('raid and event form flow', () => {
  it('posts a raid and signs the officer up with the picked role', async () => {
    await submitted(raids, {
      raid: raidId,
      day: '2026-11-20',
      hour: '20',
      minute: '00',
      signup: 'healer',
    });
    const { activity, signups } = published[0]!;
    expect(activity.kind).toBe('raid');
    expect(signups.map((x) => x.role)).toEqual(['healer']);
  });

  it('posts a raid without signing the officer up', async () => {
    await submitted(raids, { raid: raidId, day: '2026-11-20', hour: '20', minute: '00' });
    expect(published[0]!.signups).toEqual([]);
  });

  it('posts an event with the half-hour time', async () => {
    await submitted(events, {
      title: 'Fishing contest',
      description: '',
      day: '2026-11-15',
      time: '18:30',
      max: '10',
    });
    const { activity } = published[0]!;
    expect(activity.time).toEqual({ type: 'at', at: new Date('2026-11-15T17:30:00Z') });
    expect(activity.slots).toEqual({ participant: 10 });
  });

  it('changes the time from the confirmation button', async () => {
    await submitted(events, { title: 'Fishing', day: 'asap', time: '20:00', max: '' });
    const { id } = published[0]!.activity;
    await submitted(manage, { day: '2026-11-16', hour: '21', minute: '45' }, ['time', id]);
    expect((await s.activities.get(id))!.activity.time).toEqual({
      type: 'at',
      at: new Date('2026-11-16T20:45:00Z'),
    });
  });
});

describe('choosing the main character', () => {
  /** Picks a character in the `profile:main` dropdown and returns the reply. */
  async function picked(characterId: string) {
    let reply: unknown;
    const i = {
      ...member,
      isStringSelectMenu: () => true,
      values: [characterId],
      deferUpdate: async () => undefined,
      editReply: async (r: unknown) => void (reply = r),
    };
    await profiles.onComponent!(i as unknown as MessageComponentInteraction, s, ['main']);
    return reply as { embeds: { description?: string }[]; components: unknown[] };
  }

  it('sets the picked character as main and confirms', async () => {
    await s.profiles.addManual('u1', { name: 'Thorin', className: 'Warrior', level: 24 });
    const alt = await s.profiles.addManual('u1', { name: 'Lyra', className: 'Mage', level: 12 });
    const reply = await picked(alt.id);
    expect((await s.profiles.list('u1')).member?.mainCharacterId).toBe(alt.id);
    expect(reply.embeds[0]?.description).toBe('Your main character is now **Lyra, Mage 12**.');
    expect(reply.components).toEqual([]);
  });

  it('refuses a character of another member', async () => {
    await s.profiles.addManual('u1', { name: 'Thorin', className: 'Warrior', level: 24 });
    const other = await s.profiles.addManual('u2', { name: 'Kael', className: 'Rogue', level: 25 });
    await expect(picked(other.id)).rejects.toThrow('That character is not on your profile.');
  });

  it('offers the characters in a dropdown with the current main preselected', async () => {
    const main = await s.profiles.addManual('u1', {
      name: 'Thorin',
      className: 'Warrior',
      level: 24,
    });
    const alt = await s.profiles.addManual('u1', { name: 'Lyra', className: 'Mage', level: 12 });
    const { member: m, characters } = await s.profiles.list('u1');
    const menu = mainMenu(characters, m?.mainCharacterId).components[0]!;
    expect(menu.customId).toBe('profile:main');
    expect(menu.options).toEqual([
      { label: 'Thorin, Warrior 24', value: main.id, default: true },
      { label: 'Lyra, Mage 12', value: alt.id, default: false },
    ]);
  });
});

describe('finish form', () => {
  async function group(starterId: string): Promise<string> {
    const { activity } = await s.activities.create({
      guildId: 'g1',
      kind: 'dungeon',
      title: 'Deadmines',
      starter: { userId: starterId, label: 'S' },
      starterRole: 'tank',
      time: { type: 'asap' },
      slots: { tank: 1, healer: 1 },
      reminderOffsetsMin: [],
    });
    return activity.id;
  }

  it('opens for the starter with the three results and an optional report', async () => {
    const id = await group('u1');
    const form = await opened(finish, [id]);
    expect(form.custom_id).toBe(`finish:${id}`);
    expect(fieldIds(form)).toEqual(['outcome', 'report']);
    const { options } = (form.components[0] as { component: { options: { value: string }[] } })
      .component;
    expect(options.map((o) => o.value)).toEqual(['completed', 'failed', 'not_happened']);
  });

  it('records the result and the report', async () => {
    const id = await group('u1');
    await submitted(finish, { outcome: 'failed', report: 'Wiped on the last boss.' }, [id]);
    const { activity } = (await s.activities.get(id))!;
    expect([activity.state, activity.outcome, activity.report]).toEqual([
      'finished',
      'failed',
      'Wiped on the last boss.',
    ]);
    expect(published).toHaveLength(1);
  });

  it('offers the private report only when an officers channel is set', async () => {
    const id = await group('u1');
    await s.config.update('g1', { channels: { dungeon: 'c1', officers: 'off' } });
    expect(fieldIds(await opened(finish, [id]))).toEqual(['outcome', 'report', 'private']);
  });

  it('sends the private report to the officers channel and keeps it out of the log', async () => {
    const id = await group('u1');
    await s.config.update('g1', { channels: { dungeon: 'c1', officers: 'off' } });
    const sent: { embeds: { title: string; description: string }[] }[] = [];
    const channel = {
      isSendable: () => true,
      send: async (m: (typeof sent)[0]) => void sent.push(m),
    };
    member = {
      ...admin,
      client: { channels: { fetch: async (cid: string) => (cid === 'off' ? channel : null) } },
    } as typeof admin;
    const reply = await submitted(
      finish,
      { outcome: 'completed', report: 'Fine.', private: 'The healer insulted everyone.' },
      [id],
    );
    expect(reply.embeds[0]?.description).toContain('your private report went to the officers');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.embeds[0]!.title).toBe('🚩 Private report — Deadmines');
    expect(sent[0]!.embeds[0]!.description).toContain('Reported by <@u1>');
    expect(sent[0]!.embeds[0]!.description).toContain('The healer insulted everyone.');
    expect((await s.activities.get(id))!.activity.report).toBe('Fine.');
  });

  it('sends nothing to the officers when the private report is empty', async () => {
    const id = await group('u1');
    await s.config.update('g1', { channels: { dungeon: 'c1', officers: 'off' } });
    const reply = await submitted(finish, { outcome: 'completed', report: '', private: ' ' }, [id]);
    expect(reply.embeds[0]?.description).toBe('Thanks, the result is recorded.');
  });

  it('starts a group with the Start now button', async () => {
    const two = await s.activities.create({
      guildId: 'g1',
      kind: 'dungeon',
      title: 'Deadmines',
      starter: { userId: 'u1', label: 'S' },
      starterRole: 'tank',
      time: { type: 'asap' },
      slots: { tank: 1, healer: 1, dps: 3 },
      reminderOffsetsMin: [],
    });
    await s.activities.signUp(two.activity.id, 'u2', { role: 'dps', label: 'D' });
    let reply: { embeds: { description?: string }[] } | undefined;
    const i = {
      ...member,
      deferReply: async () => undefined,
      editReply: async (r: typeof reply) => void (reply = r),
    };
    await manage.onComponent!(i as unknown as MessageComponentInteraction, s, [
      'start',
      two.activity.id,
    ]);
    expect(reply?.embeds[0]?.description).toBe('The group is started and sign-ups are closed.');
    expect(published.at(-1)?.effects).toEqual([{ type: 'started' }]);
  });

  it('does not open for a member who is neither the starter nor an officer', async () => {
    const id = await group('someone-else');
    const i = { ...member, memberPermissions: { has: () => false } };
    await expect(
      finish.onComponent!(i as unknown as MessageComponentInteraction, s, [id]),
    ).rejects.toThrow('Only the starter or an officer can do that.');
  });
});
