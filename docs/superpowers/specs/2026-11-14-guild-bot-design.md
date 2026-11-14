# Guild Bot for WoW Forever — Design

Date: 2026-11-14
Status: draft, awaiting approval

Items marked **(call)** were decided by the designer, not by the project owner, and can be changed.

## 1. Intent

A Discord bot for one World of Warcraft: Forever guild. Its purpose is that guild members find each
other faster and play together more: someone who wants to run a dungeon should have a group with a
few clicks, officers should be able to organise raids, and anyone should be able to put up a casual
event.

The guild has not finished deciding what the bot should do. Features will be added and changed as
the guild decides. **The most important quality of this system is that it is cheap to change and
extend.** New features are written by a developer in code; changes made from inside Discord are
small and mostly additive (add a dungeon, add a template, adjust a reminder).

## 2. Goals, non-goals, anti-goals

**Goals (version 1)**

- Dungeon finder: any member starts a group, others join by role, everyone is notified when full.
- Raid finder: officers post raids, members sign up by role.
- Event planner: any member posts a free-form event with a limited or unlimited number of spots.
- Character profiles: members link Battle.net and pick their Forever characters, or enter them by hand.
- Officer commands for the small, frequent changes (content list, templates, reminder timing, channels).
- Requirements documented with req42 and architecture with arc42, written before code and kept current.

**Non-goals (version 1)**

- Web dashboard for officers.
- Attendance history, weekly calendar post, level-range pings, loot systems. These are expected
  later as new modules.
- Serving more than one guild / Discord server from one installation. **(call)** The data model
  keeps a server id on its records so this is not ruled out, but nothing is built for it.
- Per-character detail from Blizzard (gear, stats).

**Anti-goals**

- A new feature requiring changes to existing feature modules or a rewrite of the core.
- Group finding stopping when Blizzard's interface is unavailable or changes.
- Members being blocked from joining a group because they have no profile.
- Storing Battle.net passwords or long-lived access to members' accounts.

## 3. Constraints

- WoW Forever launched on 2026-11-04 and is based on the original 2004 game. It has no realms;
  characters have a first name and a surname. Content and group sizes may change, so the dungeon
  and raid list is data, not code.
- Blizzard's official documentation does not mention Forever. A test on 2026-11-14 with a real
  account confirmed that, after Battle.net login with scope `wow.profile`,
  `GET https://{region}.api.blizzard.com/profile/user/wow?namespace=profile-forever-{region}`
  returns each Forever character's id, name, surname, class, race, faction and level. Retail
  characters come from a different namespace and are not shown. This behaviour is unofficial and
  may change.
- Battle.net login requires a public HTTPS address for the return step. The Blizzard application
  `dungeon-organization-guild` exists; its redirect URL must be updated to the hosted address and
  its secret regenerated before going live (the test secret was exposed).
- The bot speaks English only (owner's decision): all texts and typed time input
  (`today 20:30`, `tomorrow 19:00`, `2026-11-20 19:00`). No translation layer is built.
- Project rules in `CLAUDE.md`: simplicity first, surgical changes, verifiable goals.
- Documentation templates: arc42 (markdown, 12 sections) and req42 (asciidoc, 12 sections) from the
  owner's downloaded templates.

## 4. Approaches

1. **Simple feature folders.** One program, a folder per feature, Discord handling and rules
   written together. Fastest to a first version, but rules get tangled with Discord's buttons and
   menus, features copy each other, and testing needs a live Discord server.
2. **Modular core with Discord as a thin outer layer.** One program in layers: a core that knows
   nothing about Discord, feature modules that plug into it, and outer layers for Discord, the
   database, and Blizzard. About 20–30% more code up front; new features become new modules and
   the core is tested automatically.
3. **Approach 2 plus a web dashboard.** Nicer admin screens, but a second application with its own
   login and hosting, against the wish to keep Discord-side changes small.

**Chosen by the owner: approach 2**, because flexibility to change is the main requirement and
features are added by developers in code. A dashboard stays possible later as another outer layer.

## 5. Behaviour

### 5.1 One underlying idea: the activity

Dungeon groups, raids and free events are all an **activity**: something with a title, a starter,
a time, a set of **slots**, signups, and a lifecycle. What differs comes from a **template**:

| Template kind | Who can start | Slots | Extra signup states | Reminders (defaults) |
|---|---|---|---|---|
| Dungeon | any member | by role, e.g. 1 Tank / 1 Healer / 3 DPS | waitlist | 15 min before |
| Raid | officers | by role, raid-sized | waitlist, Tentative, Can't come | 24 h and 1 h before |
| Event | any member | one open slot group, capped or unlimited | waitlist when capped | 1 h before **(call)** |

A template holds: name, kind (dungeon or raid), slot definition (role → count), and optional
reminder offsets. Officers add and edit templates from Discord. The initial dungeon and raid list
ships as a seed data file based on the original game's content. **(call)**

Rules that apply to all kinds **(calls)**:

- **Roles are a fixed set**: Tank, Healer, DPS, plus Participant for events. Templates choose
  counts per role, not new role names. A new role is a code change.
- **Events have no templates**; everything comes from the `/event` form.
- **Reminder offsets**: the per-kind setting (`/config reminders`) is the default, a template may
  override it, and the result is copied onto the activity when it is posted. Later edits to
  settings or templates do not affect activities already posted.
- **The starter and slots**: a dungeon starter always takes a slot (they chose a role). A raid or
  event starter chooses whether to sign up; "starter" is then only the person who may cancel or
  edit. The hand-over rule in 5.3 step 9 applies only to dungeons; a raid or event with no
  signups stays open until its time.
- **Lifecycle states**: open → full → finished, or cancelled / expired from open or full.
  - A full activity that loses a member goes back to open; the first waitlisted member for that
    role is promoted and mentioned in the thread. When it fills again, a short "full again" note
    goes to the thread only, with no direct messages.
  - Finished: start time plus 3 hours. For an activity with no time: 3 hours after it became full.
  - Expired: the 2-hour (ASAP) and 7-day (flexible) limits count from posting and apply while the
    activity is open, including unlimited events and activities that were full and reopened.
  - A timed activity that is not full at its start time simply continues to "finished"; the
    reminder still goes to whoever is signed up.
- **Threads**: the thread on a post is created the first time the bot has something to tell the
  group (full, a reminder, a time change, a cancellation) and reused afterwards. Reminders are
  sent whether or not the activity is full, and are skipped when nobody is signed up.

### 5.2 Time

The starter chooses one of:

- **A date and time.** Displayed with Discord's timestamp format so every member sees their own
  local time. Entered as free text in the guild's configured timezone (default Europe/Berlin)
  **(call)**; unparseable input gets a clear error with an example.
- **As soon as possible.** No reminder; when full the group is told to go now. An unfilled ASAP
  activity closes automatically after 2 hours. **(call)**
- **Flexible.** No time yet; when full, the group agrees a time in the thread. The starter can set
  a time later, which then schedules reminders. An unfilled flexible activity closes after 7 days.
  **(call)**

Raids require a date and time. **(call)**

### 5.3 Dungeon finder flow

1. Member runs `/dungeon`. The bot answers privately with: dungeon (choice list with search),
   their role, the time option.
2. The bot posts in the configured group-finder channel:

```
⚔️ Scarlet Monastery            started by Damir
🕐 Today 20:30

🛡 Tank    1/1   Brook Flok, Priest 37
💚 Healer  0/1   —
🗡 DPS     1/3   Thrall
⏳ Waitlist      —

[Tank] [Healer] [DPS] [Leave]
```

3. Others click a role button. With one character on their profile it is used; with several the
   bot asks privately which one; with none they join showing their Discord name.
4. If the role is full, the member goes on that role's waitlist. When a member leaves, the first
   waitlisted member for that role is promoted and notified.
5. A member has at most one signup per activity; clicking another role moves them.
6. When every slot is filled the bot mentions all members in the post's thread (see 5.1), and
   sends each a direct message. A member who blocks direct messages still gets the thread mention;
   a failed direct message is not an error.
7. Reminders go to the thread (mentioning members) at the template's offsets.
8. The starter (or an officer) can cancel the activity or change its time; signed-up members are
   notified in the thread or, if none exists, by mention on the post.
9. If the starter leaves, the activity continues and the longest-signed member becomes starter;
   if no one is left it closes. **(call)**
10. After the start time plus 3 hours the post is marked finished and its buttons are removed.
    **(call)**

### 5.4 Raid finder flow

Same as 5.3 with these differences: `/raid` is limited to officers; the post has additional
**Tentative** and **Can't come** buttons, shown as separate lists and not occupying slots; a time
is required; reminders at 24 h and 1 h mention confirmed and tentative members. The "full"
notification is sent when all slots are filled, as for dungeons.

### 5.5 Event planner flow

`/event` opens a form: title, description, time (as 5.2), maximum people (empty = unlimited). The
post shows the description, the list of people coming and a single **Join** / **Leave** pair of
buttons. Capped events use the waitlist; unlimited events never become "full" and only send the
reminder.

### 5.6 Character profiles

- `/profile link` — the bot replies privately with a one-time link (valid 10 minutes) to the bot's
  web address. The member logs in with Battle.net; the bot reads their Forever characters once,
  stores them, discards the access token, and confirms in Discord.
- `/profile add` — manual entry: name, surname (optional), class, level.
- `/profile show`, `/profile main` (choose main character), `/profile remove` (one character or
  everything, including the Battle.net link).
- `/profile refresh` — repeats the login to update levels and pick up new characters.
- Stored per character: Blizzard character id (if linked), name, surname, class, race, faction,
  level, source (linked or manual), last updated. Stored per member: Discord user id, Battle.net
  account id (to recognise a relink), main character.
- Linking rules **(calls)**: a Battle.net account can be linked to one Discord member only; a
  second member trying to link it is refused with an explanation. On link or refresh, a manual
  character with the same name and surname as a returned one becomes that linked character;
  linked characters Blizzard no longer returns are removed; manual characters are untouched. If
  the main character is removed, the highest-level remaining character becomes main.
- Display format: `Brook Flok, Priest 37`.
- Profiles are optional everywhere. Role is always chosen at signup, never derived from class.
- Region for the Blizzard lookup is a setting, default `eu`. **(call)**

### 5.7 Officer commands

"Officer" means a member with one of the Discord roles configured as officer roles; server
administrators always count. **(call)**

- `/config channels` — which channel each activity kind posts in.
- `/config officers` — which Discord roles are officers.
- `/config reminders` — default reminder offsets per kind.
- `/config timezone` — the guild's timezone for typed times.
- `/template add | edit | disable` — name, kind, slots. Disabling hides a template from choice
  lists without touching existing activities; there is no delete.

## 6. Architecture

One program (a modular monolith), layered so that dependencies point inward only.

```
Discord layer ─┐
Web layer ─────┼─▶ Feature modules ─▶ Core ◀─ Storage (SQLite)
Blizzard client┘                        ▲
                                        └─ Scheduler
```

- **Core** — activities, templates, slots, signups, waitlist promotion, lifecycle, reminders
  planning, permissions rules, profiles. Plain TypeScript with no Discord, database or HTTP
  imports. It defines the interfaces it needs (storage, clock, notifier, character source) and
  emits events such as *activity filled*, *member promoted*, *reminder due*.
- **Feature modules** — `dungeons`, `raids`, `events`, `profiles`, `admin`. Each registers its
  commands, its button handlers and its post layout, and calls the core. A module does not import
  another module. Adding a feature means adding a module and registering it in one place.
- **Discord layer** — discord.js. Routes slash commands, buttons, menus and forms to modules;
  renders posts; implements the notifier (thread, mention, direct message).
- **Web layer** — a minimal HTTP server with two routes: start Battle.net login from a one-time
  link, and the return step. Nothing else is served.
- **Blizzard client** — implements the character source interface with the call in section 3.
- **Storage** — SQLite with versioned migrations, behind the core's storage interface.
- **Scheduler** — reminders and automatic closing are rows in the database with a due time; a
  loop checks for due rows every 30 seconds and on startup, so nothing is lost by a restart.
  Reminders more than 10 minutes overdue at startup are skipped. **(call)**

**Technology (calls):** TypeScript on current Node.js LTS; discord.js; SQLite; Vitest for tests;
ESLint and Prettier; configuration through environment variables validated at startup; structured
logs; Docker image for deployment; GitHub Actions running lint, type check and tests.

**Robustness:** button clicks are answered within Discord's 3-second limit (acknowledge first,
then work); signup changes for one activity are applied one at a time inside a database
transaction so two simultaneous clicks cannot overfill a slot; the post is re-rendered from stored
state, so a failed edit can be retried.

**Security and privacy:** secrets only in environment variables; one-time links are random,
single-use and expire; the login uses a state value bound to the Discord user; access tokens are
never stored; `/profile remove` deletes a member's data.

## 7. Testing

- Core and feature rules are covered by automated tests using in-memory storage and a fake clock:
  slot filling, waitlist promotion, role switching, lifecycle and expiry, reminder scheduling,
  permission rules, profile linking with a fake character source.
- Storage is tested against a real temporary SQLite file.
- The Discord layer is kept thin and verified by a manual checklist on a test Discord server.
- Work proceeds test-first, per the project's rules.

## 8. Documentation

Written first, before product code, and updated with every feature:

- `docs/requirements/` — req42 in AsciiDoc, following the template's 12 sections (business goals,
  stakeholders, scope, product backlog, supporting models, quality requirements, constraints,
  domain terminology, assets, teams, roadmap, risks and assumptions). The help text is removed;
  sections that do not apply say so in one line.
- `docs/architecture/` — arc42 in Markdown, following its 12 sections. Changeability is the first
  quality goal; architecture decisions (approach 2, SQLite, no stored tokens, activity/template
  model) are recorded in section 9.
- Each new feature starts as a backlog item in req42 and ends with the arc42 building-block view
  updated.

## 9. Left to the builder

- Exact wording, emoji and layout details of posts and messages.
- Database table design and the query library.
- Folder and file names inside the layers.
- The precise seed list of dungeons and raids with their slot counts.
- Hosting specifics (which server, how HTTPS is terminated); the design only requires a public
  HTTPS address for the web layer and a persistent volume for the database file.

## 10. Risks

- Blizzard changes or withdraws the unofficial Forever lookup → manual profiles keep everything
  working; the Blizzard client is isolated behind one interface.
- Discord changes its interaction interfaces → confined to the Discord layer.
- Single SQLite file is lost → the deployment documentation must include a backup routine.
