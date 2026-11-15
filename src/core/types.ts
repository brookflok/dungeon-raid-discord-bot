export type Role = 'tank' | 'healer' | 'dps' | 'participant';
export type Kind = 'dungeon' | 'raid' | 'event';
export type TimeSpec = { type: 'at'; at: Date } | { type: 'asap' } | { type: 'flexible' };
export type ActivityState = 'open' | 'full' | 'finished' | 'cancelled' | 'expired';
export type Outcome = 'completed' | 'failed' | 'not_happened';
export type SignupStatus = 'confirmed' | 'waitlist' | 'tentative' | 'absent';
export type Slots = Partial<Record<Role, number | null>>; // null = unlimited

export interface Activity {
  id: string;
  guildId: string;
  kind: Kind;
  title: string;
  description?: string;
  starterId: string;
  time: TimeSpec;
  slots: Slots;
  reminderOffsetsMin: number[];
  state: ActivityState;
  createdAt: Date;
  filledAt?: Date;
  channelId?: string;
  messageId?: string;
  threadId?: string;
  outcome?: Outcome; // the result the starter or an officer reported
  report?: string;
  logChannelId?: string; // set once the activity was moved to the log channel
  logMessageId?: string;
}

export interface Signup {
  activityId: string;
  userId: string;
  role?: Role; // role undefined for tentative/absent
  status: SignupStatus;
  label: string; // what the post shows for this member
  createdAt: Date;
}

export interface Template {
  id: string;
  guildId: string;
  kind: 'dungeon' | 'raid';
  name: string;
  slots: Slots;
  reminderOffsetsMin?: number[];
  enabled: boolean;
}

export interface GuildConfig {
  guildId: string;
  channels: Partial<Record<Kind | 'log', string>>; // log: where finished activities are moved
  officerRoleIds: string[];
  reminders: Record<Kind, number[]>;
  timezone: string;
}

export interface Character {
  id: string;
  userId: string;
  blizzardId?: number;
  name: string;
  surname?: string;
  className: string;
  race?: string;
  faction?: string;
  level: number;
  source: 'linked' | 'manual';
  updatedAt: Date;
}

export interface Member {
  userId: string;
  battleNetId?: number;
  mainCharacterId?: string;
}

export interface LinkToken {
  token: string;
  userId: string;
  expiresAt: Date;
}

export type JobType = 'reminder' | 'expire' | 'finish';
export interface Job {
  id: string;
  activityId: string;
  type: JobType;
  dueAt: Date;
}

export class UserError extends Error {}
