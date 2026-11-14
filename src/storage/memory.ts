import type { Storage } from '../core/ports.js';
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
} from '../core/types.js';

const copy = <T>(value: T): T => structuredClone(value);

export class MemoryStorage implements Storage {
  private activities = new Map<string, Activity>();
  private signups: Signup[] = [];
  private jobs: Job[] = [];
  private nextJobId = 1;
  private templates = new Map<string, Template>();
  private configs = new Map<string, GuildConfig>();
  private members = new Map<string, Member>();
  private characters = new Map<string, Character>();
  private linkTokens = new Map<string, LinkToken>();

  insertActivity(a: Activity): Promise<void> {
    this.activities.set(a.id, copy(a));
    return Promise.resolve();
  }

  updateActivity(a: Activity): Promise<void> {
    return this.insertActivity(a);
  }

  getActivity(id: string): Promise<Activity | null> {
    const a = this.activities.get(id);
    return Promise.resolve(a ? copy(a) : null);
  }

  findOpenActivities(guildId: string, kind: Kind, starterId: string): Promise<Activity[]> {
    return Promise.resolve(
      [...this.activities.values()]
        .filter(
          (a) =>
            a.guildId === guildId &&
            a.kind === kind &&
            a.starterId === starterId &&
            (a.state === 'open' || a.state === 'full'),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(copy),
    );
  }

  findActivityByMessage(messageId: string): Promise<Activity | null> {
    const a = [...this.activities.values()].find((x) => x.messageId === messageId);
    return Promise.resolve(a ? copy(a) : null);
  }

  listSignups(activityId: string): Promise<Signup[]> {
    return Promise.resolve(
      this.signups
        .filter((s) => s.activityId === activityId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(copy),
    );
  }

  upsertSignup(s: Signup): Promise<void> {
    const i = this.signups.findIndex((x) => x.activityId === s.activityId && x.userId === s.userId);
    if (i >= 0) this.signups[i] = copy(s);
    else this.signups.push(copy(s));
    return Promise.resolve();
  }

  deleteSignup(activityId: string, userId: string): Promise<void> {
    this.signups = this.signups.filter((s) => s.activityId !== activityId || s.userId !== userId);
    return Promise.resolve();
  }

  replaceJobs(activityId: string, jobs: Omit<Job, 'id'>[]): Promise<void> {
    this.jobs = this.jobs.filter((j) => j.activityId !== activityId);
    for (const j of jobs) this.jobs.push({ ...copy(j), id: String(this.nextJobId++) });
    return Promise.resolve();
  }

  dueJobs(now: Date): Promise<Job[]> {
    return Promise.resolve(this.jobs.filter((j) => j.dueAt <= now).map(copy));
  }

  deleteJob(id: string): Promise<void> {
    this.jobs = this.jobs.filter((j) => j.id !== id);
    return Promise.resolve();
  }

  insertTemplate(t: Template): Promise<void> {
    this.templates.set(t.id, copy(t));
    return Promise.resolve();
  }

  updateTemplate(t: Template): Promise<void> {
    return this.insertTemplate(t);
  }

  getTemplate(id: string): Promise<Template | null> {
    const t = this.templates.get(id);
    return Promise.resolve(t ? copy(t) : null);
  }

  listTemplates(guildId: string, kind?: 'dungeon' | 'raid'): Promise<Template[]> {
    return Promise.resolve(
      [...this.templates.values()]
        .filter((t) => t.guildId === guildId && (!kind || t.kind === kind))
        .map(copy),
    );
  }

  getConfig(guildId: string): Promise<GuildConfig | null> {
    const c = this.configs.get(guildId);
    return Promise.resolve(c ? copy(c) : null);
  }

  saveConfig(c: GuildConfig): Promise<void> {
    this.configs.set(c.guildId, copy(c));
    return Promise.resolve();
  }

  getMember(userId: string): Promise<Member | null> {
    const m = this.members.get(userId);
    return Promise.resolve(m ? copy(m) : null);
  }

  saveMember(m: Member): Promise<void> {
    this.members.set(m.userId, copy(m));
    return Promise.resolve();
  }

  findMemberByBattleNet(battleNetId: number): Promise<Member | null> {
    const m = [...this.members.values()].find((x) => x.battleNetId === battleNetId);
    return Promise.resolve(m ? copy(m) : null);
  }

  deleteMember(userId: string): Promise<void> {
    this.members.delete(userId);
    for (const [id, c] of this.characters) if (c.userId === userId) this.characters.delete(id);
    return Promise.resolve();
  }

  listCharacters(userId: string): Promise<Character[]> {
    return Promise.resolve(
      [...this.characters.values()].filter((c) => c.userId === userId).map(copy),
    );
  }

  saveCharacter(c: Character): Promise<void> {
    this.characters.set(c.id, copy(c));
    return Promise.resolve();
  }

  deleteCharacter(id: string): Promise<void> {
    this.characters.delete(id);
    return Promise.resolve();
  }

  insertLinkToken(t: LinkToken): Promise<void> {
    this.linkTokens.set(t.token, copy(t));
    return Promise.resolve();
  }

  takeLinkToken(token: string, now: Date): Promise<LinkToken | null> {
    const t = this.linkTokens.get(token);
    if (!t) return Promise.resolve(null);
    this.linkTokens.delete(token);
    return Promise.resolve(t.expiresAt < now ? null : t);
  }
}
