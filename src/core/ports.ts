import type {
  Activity,
  Character,
  GuildConfig,
  Job,
  Kind,
  LinkToken,
  Member,
  Signup,
  Template,
} from './types.js';

export interface Clock {
  now(): Date;
}

export interface Storage {
  insertActivity(a: Activity): Promise<void>;
  updateActivity(a: Activity): Promise<void>;
  getActivity(id: string): Promise<Activity | null>;
  findOpenActivities(guildId: string, kind: Kind, starterId: string): Promise<Activity[]>; // open or full, newest first
  findActivityByMessage(messageId: string): Promise<Activity | null>;
  listSignups(activityId: string): Promise<Signup[]>; // ordered by createdAt
  upsertSignup(s: Signup): Promise<void>;
  deleteSignup(activityId: string, userId: string): Promise<void>;
  replaceJobs(activityId: string, jobs: Omit<Job, 'id'>[]): Promise<void>;
  dueJobs(now: Date): Promise<Job[]>;
  deleteJob(id: string): Promise<void>;
  insertTemplate(t: Template): Promise<void>;
  updateTemplate(t: Template): Promise<void>;
  getTemplate(id: string): Promise<Template | null>;
  listTemplates(guildId: string, kind?: 'dungeon' | 'raid'): Promise<Template[]>;
  getConfig(guildId: string): Promise<GuildConfig | null>;
  saveConfig(c: GuildConfig): Promise<void>;
  getMember(userId: string): Promise<Member | null>;
  saveMember(m: Member): Promise<void>;
  findMemberByBattleNet(battleNetId: number): Promise<Member | null>;
  deleteMember(userId: string): Promise<void>; // also deletes their characters
  listCharacters(userId: string): Promise<Character[]>;
  saveCharacter(c: Character): Promise<void>;
  deleteCharacter(id: string): Promise<void>;
  insertLinkToken(t: LinkToken): Promise<void>;
  takeLinkToken(token: string, now: Date): Promise<LinkToken | null>; // null if unknown, expired or already taken; marks taken
}
