import { randomUUID } from 'node:crypto';
import type { Clock, Storage } from './ports.js';
import {
  UserError,
  type Activity,
  type Kind,
  type Role,
  type Signup,
  type Slots,
  type TimeSpec,
} from './types.js';

export type Effect =
  | { type: 'filled' } // first time full: thread mention + direct messages
  | { type: 'refilled' } // full again: short thread note only
  | { type: 'promoted'; userId: string }
  | { type: 'starterChanged'; userId: string }
  | { type: 'timeChanged' }
  | { type: 'cancelled' }
  | { type: 'reminder'; minutesBefore: number }
  | { type: 'closed'; reason: 'expired' | 'finished' | 'empty' };

export interface ActivityView {
  activity: Activity;
  signups: Signup[];
}
export interface ActivityResult extends ActivityView {
  effects: Effect[];
}
export interface Actor {
  userId: string;
  isOfficer: boolean;
}
export interface CreateActivityInput {
  guildId: string;
  kind: Kind;
  title: string;
  description?: string;
  starter: { userId: string; label: string };
  starterRole?: Role; // required for dungeons
  time: TimeSpec;
  slots: Slots;
  reminderOffsetsMin: number[];
}
export type SignupChoice =
  { role: Role; label: string } | { status: 'tentative' | 'absent'; label: string };

const CLOSED = 'This group is closed.';

export class ActivityService {
  private readonly storage: Storage;
  private readonly clock: Clock;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: { storage: Storage; clock: Clock }) {
    this.storage = deps.storage;
    this.clock = deps.clock;
  }

  /** Runs mutations one at a time so concurrent calls cannot interleave. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  create(input: CreateActivityInput): Promise<ActivityResult> {
    return this.serialize(async () => {
      const now = this.clock.now();
      if (input.kind === 'raid' && input.time.type !== 'at') {
        throw new UserError('A raid needs a date and time.');
      }
      if (input.time.type === 'at' && input.time.at < now) {
        throw new UserError('That time is in the past. Try "today 20:30" or "2026-11-20 19:00".');
      }
      if (input.kind === 'dungeon') {
        if (!input.starterRole) throw new UserError('Choose a role for yourself.');
        if (input.slots[input.starterRole] === undefined) {
          throw new UserError('That role is not part of this group.');
        }
      }
      const activity: Activity = {
        id: randomUUID(),
        guildId: input.guildId,
        kind: input.kind,
        title: input.title,
        starterId: input.starter.userId,
        time: input.time,
        slots: input.slots,
        reminderOffsetsMin: input.reminderOffsetsMin,
        state: 'open',
        createdAt: now,
      };
      if (input.description !== undefined) activity.description = input.description;
      await this.storage.insertActivity(activity);
      if (input.kind === 'dungeon') {
        await this.storage.upsertSignup({
          activityId: activity.id,
          userId: input.starter.userId,
          role: input.starterRole,
          status: 'confirmed',
          label: input.starter.label,
          createdAt: now,
        });
      }
      const effects: Effect[] = [];
      await this.refreshState(activity, effects);
      return this.result(activity.id, effects);
    });
  }

  signUp(activityId: string, userId: string, choice: SignupChoice): Promise<ActivityResult> {
    return this.serialize(async () => {
      const activity = await this.requireActivity(activityId);
      if (activity.state !== 'open' && activity.state !== 'full') throw new UserError(CLOSED);
      const role = 'role' in choice ? choice.role : undefined;
      if (role) {
        if (activity.slots[role] === undefined)
          throw new UserError('That role is not available here.');
      } else if (activity.kind !== 'raid') {
        throw new UserError("Only raids have Tentative and Can't come.");
      }

      const effects: Effect[] = [];
      const existing = (await this.storage.listSignups(activityId)).find(
        (s) => s.userId === userId,
      );
      const same = 'role' in choice ? existing?.role === role : existing?.status === choice.status;
      if (existing && same) {
        return this.result(activityId, effects);
      }
      if (existing) {
        await this.storage.deleteSignup(activityId, userId);
        if (existing.status === 'confirmed' && existing.role) {
          await this.promote(activity, existing.role, effects);
        }
      }

      const signup: Signup = {
        activityId,
        userId,
        status: 'status' in choice ? choice.status : 'confirmed',
        label: choice.label,
        createdAt: this.clock.now(),
      };
      if (role) {
        signup.role = role;
        const cap = activity.slots[role];
        if (cap !== null && cap !== undefined) {
          const confirmed = (await this.storage.listSignups(activityId)).filter(
            (s) => s.role === role && s.status === 'confirmed',
          );
          if (confirmed.length >= cap) signup.status = 'waitlist';
        }
      }
      await this.storage.upsertSignup(signup);
      await this.refreshState(activity, effects);
      return this.result(activityId, effects);
    });
  }

  leave(activityId: string, userId: string): Promise<ActivityResult> {
    return this.serialize(async () => {
      const activity = await this.requireActivity(activityId);
      if (activity.state !== 'open' && activity.state !== 'full') throw new UserError(CLOSED);
      const existing = (await this.storage.listSignups(activityId)).find(
        (s) => s.userId === userId,
      );
      if (!existing) throw new UserError('You are not signed up.');

      const effects: Effect[] = [];
      await this.storage.deleteSignup(activityId, userId);
      if (existing.status === 'confirmed' && existing.role) {
        await this.promote(activity, existing.role, effects);
      }

      if (activity.kind === 'dungeon' && activity.starterId === userId) {
        const rest = await this.storage.listSignups(activityId);
        const next = rest.find((s) => s.status === 'confirmed');
        if (rest.length === 0) {
          activity.state = 'expired';
          await this.storage.updateActivity(activity);
          effects.push({ type: 'closed', reason: 'empty' });
          return this.result(activityId, effects);
        }
        if (next) {
          activity.starterId = next.userId;
          await this.storage.updateActivity(activity);
          effects.push({ type: 'starterChanged', userId: next.userId });
        }
      }
      await this.refreshState(activity, effects);
      return this.result(activityId, effects);
    });
  }

  setPost(activityId: string, post: { channelId: string; messageId: string }): Promise<void> {
    return this.serialize(async () => {
      const activity = await this.requireActivity(activityId);
      await this.storage.updateActivity({ ...activity, ...post });
    });
  }

  setThread(activityId: string, threadId: string): Promise<void> {
    return this.serialize(async () => {
      const activity = await this.requireActivity(activityId);
      await this.storage.updateActivity({ ...activity, threadId });
    });
  }

  async get(activityId: string): Promise<ActivityView | null> {
    const activity = await this.storage.getActivity(activityId);
    if (!activity) return null;
    return { activity, signups: await this.storage.listSignups(activityId) };
  }

  private async requireActivity(activityId: string): Promise<Activity> {
    const activity = await this.storage.getActivity(activityId);
    if (!activity) throw new UserError('That group no longer exists.');
    return activity;
  }

  private async result(activityId: string, effects: Effect[]): Promise<ActivityResult> {
    const view = (await this.get(activityId))!;
    return { ...view, effects };
  }

  /** Confirms the earliest waitlisted member of a role if a slot is free. */
  private async promote(activity: Activity, role: Role, effects: Effect[]): Promise<void> {
    const cap = activity.slots[role];
    if (cap === null || cap === undefined) return;
    const signups = await this.storage.listSignups(activity.id);
    const confirmed = signups.filter((s) => s.role === role && s.status === 'confirmed').length;
    const next = signups.find((s) => s.role === role && s.status === 'waitlist');
    if (!next || confirmed >= cap) return;
    await this.storage.upsertSignup({ ...next, status: 'confirmed' });
    effects.push({ type: 'promoted', userId: next.userId });
  }

  /** Moves an open/full activity between open and full and records the effect. */
  private async refreshState(activity: Activity, effects: Effect[]): Promise<void> {
    const signups = await this.storage.listSignups(activity.id);
    const capped = Object.entries(activity.slots).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    );
    const full =
      capped.length > 0 &&
      capped.every(
        ([role, cap]) =>
          signups.filter((s) => s.role === role && s.status === 'confirmed').length >= cap,
      );
    if (full && activity.state === 'open') {
      activity.state = 'full';
      effects.push({ type: activity.filledAt ? 'refilled' : 'filled' });
      activity.filledAt ??= this.clock.now();
      await this.storage.updateActivity(activity);
    } else if (!full && activity.state === 'full') {
      activity.state = 'open';
      await this.storage.updateActivity(activity);
    }
  }
}
