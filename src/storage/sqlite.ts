import { readdirSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
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
  TimeSpec,
} from '../core/types.js';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

type Row = Record<string, unknown>;

const iso = (d: Date): string => d.toISOString();
const optDate = (v: unknown): Date | undefined => (v === null ? undefined : new Date(v as string));
const opt = <T>(v: unknown): T | undefined => (v === null ? undefined : (v as T));
const json = (v: unknown): string => JSON.stringify(v);
const parse = <T>(v: unknown): T => JSON.parse(v as string) as T;

function timeToJson(t: TimeSpec): string {
  return json(t.type === 'at' ? { type: 'at', at: iso(t.at) } : t);
}

function timeFromJson(v: unknown): TimeSpec {
  const t = parse<{ type: 'at' | 'asap' | 'flexible'; at?: string }>(v);
  return t.type === 'at' ? { type: 'at', at: new Date(t.at!) } : { type: t.type };
}

function toActivity(r: Row): Activity {
  const a: Activity = {
    id: r.id as string,
    guildId: r.guild_id as string,
    kind: r.kind as Activity['kind'],
    title: r.title as string,
    starterId: r.starter_id as string,
    time: timeFromJson(r.time),
    slots: parse(r.slots),
    reminderOffsetsMin: parse(r.reminder_offsets_min),
    state: r.state as Activity['state'],
    createdAt: new Date(r.created_at as string),
  };
  const description = opt<string>(r.description);
  const filledAt = optDate(r.filled_at);
  const channelId = opt<string>(r.channel_id);
  const messageId = opt<string>(r.message_id);
  const threadId = opt<string>(r.thread_id);
  if (description !== undefined) a.description = description;
  if (filledAt !== undefined) a.filledAt = filledAt;
  if (channelId !== undefined) a.channelId = channelId;
  if (messageId !== undefined) a.messageId = messageId;
  if (threadId !== undefined) a.threadId = threadId;
  return a;
}

function toSignup(r: Row): Signup {
  const s: Signup = {
    activityId: r.activity_id as string,
    userId: r.user_id as string,
    status: r.status as Signup['status'],
    label: r.label as string,
    createdAt: new Date(r.created_at as string),
  };
  const role = opt<Signup['role']>(r.role);
  if (role !== undefined) s.role = role;
  return s;
}

function toTemplate(r: Row): Template {
  const t: Template = {
    id: r.id as string,
    guildId: r.guild_id as string,
    kind: r.kind as Template['kind'],
    name: r.name as string,
    slots: parse(r.slots),
    enabled: r.enabled === 1,
  };
  if (r.reminder_offsets_min !== null) t.reminderOffsetsMin = parse(r.reminder_offsets_min);
  return t;
}

function toMember(r: Row): Member {
  const m: Member = { userId: r.user_id as string };
  const battleNetId = opt<number>(r.battle_net_id);
  const mainCharacterId = opt<string>(r.main_character_id);
  if (battleNetId !== undefined) m.battleNetId = battleNetId;
  if (mainCharacterId !== undefined) m.mainCharacterId = mainCharacterId;
  return m;
}

function toCharacter(r: Row): Character {
  const c: Character = {
    id: r.id as string,
    userId: r.user_id as string,
    name: r.name as string,
    className: r.class_name as string,
    level: r.level as number,
    source: r.source as Character['source'],
    updatedAt: new Date(r.updated_at as string),
  };
  const blizzardId = opt<number>(r.blizzard_id);
  const surname = opt<string>(r.surname);
  const race = opt<string>(r.race);
  const faction = opt<string>(r.faction);
  if (blizzardId !== undefined) c.blizzardId = blizzardId;
  if (surname !== undefined) c.surname = surname;
  if (race !== undefined) c.race = race;
  if (faction !== undefined) c.faction = faction;
  return c;
}

const ACTIVITY_PARAMS = (a: Activity) => ({
  id: a.id,
  guildId: a.guildId,
  kind: a.kind,
  title: a.title,
  description: a.description ?? null,
  starterId: a.starterId,
  time: timeToJson(a.time),
  slots: json(a.slots),
  reminders: json(a.reminderOffsetsMin),
  state: a.state,
  createdAt: iso(a.createdAt),
  filledAt: a.filledAt ? iso(a.filledAt) : null,
  channelId: a.channelId ?? null,
  messageId: a.messageId ?? null,
  threadId: a.threadId ?? null,
});

const TEMPLATE_PARAMS = (t: Template) => ({
  id: t.id,
  guildId: t.guildId,
  kind: t.kind,
  name: t.name,
  slots: json(t.slots),
  reminders: t.reminderOffsetsMin ? json(t.reminderOffsetsMin) : null,
  enabled: t.enabled ? 1 : 0,
});

export class SqliteStorage implements Storage {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    const applied = new Set(
      this.db
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((r) => (r as { version: number }).version),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .sort();
    for (const file of files) {
      const version = Number.parseInt(file, 10);
      if (applied.has(version)) continue;
      const sql = readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8');
      this.db.transaction(() => {
        this.db.exec(sql);
        this.db
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(version, iso(new Date()));
      })();
    }
  }

  insertActivity(a: Activity): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO activities (id, guild_id, kind, title, description, starter_id, time, slots,
           reminder_offsets_min, state, created_at, filled_at, channel_id, message_id, thread_id)
         VALUES (@id, @guildId, @kind, @title, @description, @starterId, @time, @slots,
           @reminders, @state, @createdAt, @filledAt, @channelId, @messageId, @threadId)`,
      )
      .run(ACTIVITY_PARAMS(a));
    return Promise.resolve();
  }

  updateActivity(a: Activity): Promise<void> {
    return this.insertActivity(a);
  }

  getActivity(id: string): Promise<Activity | null> {
    const r = this.db.prepare('SELECT * FROM activities WHERE id = ?').get(id) as Row | undefined;
    return Promise.resolve(r ? toActivity(r) : null);
  }

  findOpenActivities(guildId: string, kind: Kind, starterId: string): Promise<Activity[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM activities WHERE guild_id = ? AND kind = ? AND starter_id = ?
           AND state IN ('open', 'full') ORDER BY created_at DESC, rowid DESC`,
      )
      .all(guildId, kind, starterId) as Row[];
    return Promise.resolve(rows.map(toActivity));
  }

  findActivityByMessage(messageId: string): Promise<Activity | null> {
    const r = this.db.prepare('SELECT * FROM activities WHERE message_id = ?').get(messageId) as
      Row | undefined;
    return Promise.resolve(r ? toActivity(r) : null);
  }

  listSignups(activityId: string): Promise<Signup[]> {
    const rows = this.db
      .prepare('SELECT * FROM signups WHERE activity_id = ? ORDER BY created_at, rowid')
      .all(activityId) as Row[];
    return Promise.resolve(rows.map(toSignup));
  }

  upsertSignup(s: Signup): Promise<void> {
    // ON CONFLICT keeps the original rowid, so insertion order survives an update.
    this.db
      .prepare(
        `INSERT INTO signups (activity_id, user_id, role, status, label, created_at)
         VALUES (@activityId, @userId, @role, @status, @label, @createdAt)
         ON CONFLICT (activity_id, user_id) DO UPDATE SET
           role = excluded.role, status = excluded.status,
           label = excluded.label, created_at = excluded.created_at`,
      )
      .run({
        activityId: s.activityId,
        userId: s.userId,
        role: s.role ?? null,
        status: s.status,
        label: s.label,
        createdAt: iso(s.createdAt),
      });
    return Promise.resolve();
  }

  deleteSignup(activityId: string, userId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM signups WHERE activity_id = ? AND user_id = ?')
      .run(activityId, userId);
    return Promise.resolve();
  }

  replaceJobs(activityId: string, jobs: Omit<Job, 'id'>[]): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM jobs WHERE activity_id = ?').run(activityId);
      const insert = this.db.prepare(
        'INSERT INTO jobs (activity_id, type, due_at) VALUES (?, ?, ?)',
      );
      for (const j of jobs) insert.run(j.activityId, j.type, iso(j.dueAt));
    })();
    return Promise.resolve();
  }

  dueJobs(now: Date): Promise<Job[]> {
    const rows = this.db
      .prepare('SELECT * FROM jobs WHERE due_at <= ? ORDER BY id')
      .all(iso(now)) as Row[];
    return Promise.resolve(
      rows.map((r) => ({
        id: String(r.id),
        activityId: r.activity_id as string,
        type: r.type as Job['type'],
        dueAt: new Date(r.due_at as string),
      })),
    );
  }

  deleteJob(id: string): Promise<void> {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    return Promise.resolve();
  }

  insertTemplate(t: Template): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO templates (id, guild_id, kind, name, slots, reminder_offsets_min, enabled)
         VALUES (@id, @guildId, @kind, @name, @slots, @reminders, @enabled)
         ON CONFLICT (id) DO UPDATE SET guild_id = excluded.guild_id, kind = excluded.kind,
           name = excluded.name, slots = excluded.slots,
           reminder_offsets_min = excluded.reminder_offsets_min, enabled = excluded.enabled`,
      )
      .run(TEMPLATE_PARAMS(t));
    return Promise.resolve();
  }

  updateTemplate(t: Template): Promise<void> {
    return this.insertTemplate(t);
  }

  getTemplate(id: string): Promise<Template | null> {
    const r = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as Row | undefined;
    return Promise.resolve(r ? toTemplate(r) : null);
  }

  listTemplates(guildId: string, kind?: 'dungeon' | 'raid'): Promise<Template[]> {
    const rows = (
      kind
        ? this.db
            .prepare('SELECT * FROM templates WHERE guild_id = ? AND kind = ? ORDER BY rowid')
            .all(guildId, kind)
        : this.db.prepare('SELECT * FROM templates WHERE guild_id = ? ORDER BY rowid').all(guildId)
    ) as Row[];
    return Promise.resolve(rows.map(toTemplate));
  }

  getConfig(guildId: string): Promise<GuildConfig | null> {
    const r = this.db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId) as
      Row | undefined;
    return Promise.resolve(
      r
        ? {
            guildId: r.guild_id as string,
            channels: parse(r.channels),
            officerRoleIds: parse(r.officer_role_ids),
            reminders: parse(r.reminders),
            timezone: r.timezone as string,
          }
        : null,
    );
  }

  saveConfig(c: GuildConfig): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO guild_config (guild_id, channels, officer_role_ids, reminders, timezone)
         VALUES (@guildId, @channels, @officers, @reminders, @timezone)
         ON CONFLICT (guild_id) DO UPDATE SET channels = excluded.channels,
           officer_role_ids = excluded.officer_role_ids, reminders = excluded.reminders,
           timezone = excluded.timezone`,
      )
      .run({
        guildId: c.guildId,
        channels: json(c.channels),
        officers: json(c.officerRoleIds),
        reminders: json(c.reminders),
        timezone: c.timezone,
      });
    return Promise.resolve();
  }

  getMember(userId: string): Promise<Member | null> {
    const r = this.db.prepare('SELECT * FROM members WHERE user_id = ?').get(userId) as
      Row | undefined;
    return Promise.resolve(r ? toMember(r) : null);
  }

  saveMember(m: Member): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO members (user_id, battle_net_id, main_character_id)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET battle_net_id = excluded.battle_net_id,
           main_character_id = excluded.main_character_id`,
      )
      .run(m.userId, m.battleNetId ?? null, m.mainCharacterId ?? null);
    return Promise.resolve();
  }

  findMemberByBattleNet(battleNetId: number): Promise<Member | null> {
    const r = this.db
      .prepare('SELECT * FROM members WHERE battle_net_id = ? ORDER BY rowid LIMIT 1')
      .get(battleNetId) as Row | undefined;
    return Promise.resolve(r ? toMember(r) : null);
  }

  deleteMember(userId: string): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM characters WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM members WHERE user_id = ?').run(userId);
    })();
    return Promise.resolve();
  }

  listCharacters(userId: string): Promise<Character[]> {
    const rows = this.db
      .prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY rowid')
      .all(userId) as Row[];
    return Promise.resolve(rows.map(toCharacter));
  }

  saveCharacter(c: Character): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO characters (id, user_id, blizzard_id, name, surname, class_name, race, faction,
           level, source, updated_at)
         VALUES (@id, @userId, @blizzardId, @name, @surname, @className, @race, @faction,
           @level, @source, @updatedAt)
         ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, blizzard_id = excluded.blizzard_id,
           name = excluded.name, surname = excluded.surname, class_name = excluded.class_name,
           race = excluded.race, faction = excluded.faction, level = excluded.level,
           source = excluded.source, updated_at = excluded.updated_at`,
      )
      .run({
        id: c.id,
        userId: c.userId,
        blizzardId: c.blizzardId ?? null,
        name: c.name,
        surname: c.surname ?? null,
        className: c.className,
        race: c.race ?? null,
        faction: c.faction ?? null,
        level: c.level,
        source: c.source,
        updatedAt: iso(c.updatedAt),
      });
    return Promise.resolve();
  }

  deleteCharacter(id: string): Promise<void> {
    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
    return Promise.resolve();
  }

  insertLinkToken(t: LinkToken): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO link_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(t.token, t.userId, iso(t.expiresAt));
    return Promise.resolve();
  }

  takeLinkToken(token: string, now: Date): Promise<LinkToken | null> {
    const taken = this.db.transaction((): Row | undefined => {
      const r = this.db.prepare('SELECT * FROM link_tokens WHERE token = ?').get(token) as
        Row | undefined;
      if (r) this.db.prepare('DELETE FROM link_tokens WHERE token = ?').run(token);
      return r;
    })();
    if (!taken) return Promise.resolve(null);
    const expiresAt = new Date(taken.expires_at as string);
    if (expiresAt < now) return Promise.resolve(null);
    return Promise.resolve({ token, userId: taken.user_id as string, expiresAt });
  }
}
