import { MessageFlags, type Interaction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../../src/core/config.js';
import { UserError } from '../../src/core/types.js';
import {
  actorOf,
  createRouter,
  routeKey,
  type BotModule,
  type Services,
} from '../../src/discord/registry.js';
import { notice } from '../../src/discord/notice.js';
import { MemoryStorage } from '../../src/storage/memory.js';

const services = {} as Services;

function commandModule(name: string, onCommand?: BotModule['onCommand']): BotModule {
  return { name, commands: [{ name, description: name }], onCommand };
}

function fakeInteraction(fields: Record<string, unknown>) {
  const replies: unknown[] = [];
  const i = {
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply: async (o: unknown) => void replies.push(o),
    followUp: async (o: unknown) => void replies.push(o),
    ...fields,
  };
  return { i: i as unknown as Interaction, replies };
}

describe('routeKey', () => {
  it('splits a custom id into module and arguments', () => {
    expect(routeKey('act:abc:pick:tank')).toEqual({ module: 'act', args: ['abc', 'pick', 'tank'] });
  });
});

describe('createRouter', () => {
  it('throws when two modules register the same command name', () => {
    expect(() =>
      createRouter([commandModule('dungeon'), commandModule('dungeon')], services),
    ).toThrow();
  });

  it('throws when two modules use the same name (custom-id prefix)', () => {
    expect(() =>
      createRouter(
        [
          { name: 'act', commands: [] },
          { name: 'act', commands: [{ name: 'other', description: 'other' }] },
        ],
        services,
      ),
    ).toThrow('Module "act" is registered twice.');
  });

  it('answers a UserError privately with its message', async () => {
    const route = createRouter(
      [
        commandModule('dungeon', async () => {
          throw new UserError('x');
        }),
      ],
      services,
    );
    const { i, replies } = fakeInteraction({
      isChatInputCommand: () => true,
      commandName: 'dungeon',
    });
    await route(i);
    expect(replies).toEqual([{ ...notice('x', 'error'), flags: MessageFlags.Ephemeral }]);
  });

  it('logs other errors and answers "Something went wrong."', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const route = createRouter(
      [
        commandModule('dungeon', async () => {
          throw new Error('boom');
        }),
      ],
      services,
    );
    const { i, replies } = fakeInteraction({
      isChatInputCommand: () => true,
      commandName: 'dungeon',
      deferred: true,
    });
    await route(i);
    expect(replies).toEqual([
      { ...notice('Something went wrong.', 'error'), flags: MessageFlags.Ephemeral },
    ]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('routes a component to its module by custom-id prefix', async () => {
    const onComponent = vi.fn(async () => {});
    const route = createRouter([{ name: 'act', commands: [], onComponent }], services);
    const { i } = fakeInteraction({ isMessageComponent: () => true, customId: 'act:a1:tank' });
    await route(i);
    expect(onComponent).toHaveBeenCalledWith(i, services, ['a1', 'tank']);
  });
});

describe('actorOf', () => {
  it('marks members with an officer role as officers', async () => {
    const config = new ConfigService(new MemoryStorage());
    await config.update('g1', { officerRoleIds: ['officer'] });
    const s = { config } as Services;
    const member = (roles: string[]) =>
      fakeInteraction({
        user: { id: 'u1' },
        guildId: 'g1',
        member: { roles },
        memberPermissions: { has: () => false },
      }).i;
    expect(await actorOf(member(['officer']), s)).toEqual({ userId: 'u1', isOfficer: true });
    expect(await actorOf(member(['raider']), s)).toEqual({ userId: 'u1', isOfficer: false });
  });
});
