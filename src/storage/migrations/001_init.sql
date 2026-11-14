CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  starter_id TEXT NOT NULL,
  time TEXT NOT NULL,
  slots TEXT NOT NULL,
  reminder_offsets_min TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  filled_at TEXT,
  channel_id TEXT,
  message_id TEXT,
  thread_id TEXT
);
CREATE INDEX activities_guild ON activities (guild_id);

CREATE TABLE signups (
  activity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL,
  type TEXT NOT NULL,
  due_at TEXT NOT NULL
);
CREATE INDEX jobs_activity ON jobs (activity_id);
CREATE INDEX jobs_due ON jobs (due_at);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  slots TEXT NOT NULL,
  reminder_offsets_min TEXT,
  enabled INTEGER NOT NULL
);
CREATE INDEX templates_guild ON templates (guild_id, kind);

CREATE TABLE guild_config (
  guild_id TEXT PRIMARY KEY,
  channels TEXT NOT NULL,
  officer_role_ids TEXT NOT NULL,
  reminders TEXT NOT NULL,
  timezone TEXT NOT NULL
);

CREATE TABLE members (
  user_id TEXT PRIMARY KEY,
  battle_net_id INTEGER,
  main_character_id TEXT
);
CREATE INDEX members_battle_net ON members (battle_net_id);

-- No foreign key to members: the core saves a new member's characters first.
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  blizzard_id INTEGER,
  name TEXT NOT NULL,
  surname TEXT,
  class_name TEXT NOT NULL,
  race TEXT,
  faction TEXT,
  level INTEGER NOT NULL,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX characters_user ON characters (user_id);

CREATE TABLE link_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
