# Dungeon & Raid Discord Bot

A Discord bot for a World of Warcraft: Forever guild. Members find dungeon groups, officers post raids, and anyone can plan a guild event, all with sign-up buttons on one post.

- **Dungeon finder:** press "Start a dungeon group" and pick a dungeon, your role and a time from dropdowns (a day and time, "as soon as possible" or "flexible"). Others join as Tank, Healer or DPS. When the group is full, everyone is mentioned in a thread, gets a direct message, and is reminded before the start.
- **Raid finder:** officers post a raid; members sign up by role, as tentative, or as absent. Extra sign-ups go on a waitlist and move up when a spot opens.
- **Event planner:** a free-form event with a description and limited or unlimited spots.
- **Start now:** the starter of a dungeon or raid that is not full can start with the players signed up so far (at least 2); sign-ups close and the group gets its thread.
- **Event threads:** every event gets a thread when it is posted, and members are added to it as they join.
- **Private reports:** on finishing, the starter can also send a report about bad behaviour that only the officers' channel receives.
- **Results log:** the starter finishes a group with a result and an optional report; the post moves to a public log channel.
- **Character profiles:** members link their Battle.net account and sign up with their Forever character.

## Commands

| Command                                                                           | Who        | What it does                                         |
| --------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------- |
| `/dungeon start`, `cancel`, `time`                                                | everyone   | Start a dungeon group, cancel it, or change its time |
| `/raid post`, `cancel`, `time`                                                    | raid hosts | Post a raid, cancel it, or change its time           |
| `/event post`, `cancel`, `time`                                                   | everyone   | Post an event, cancel it, or change its time         |
| `/profile link`, `refresh`, `add`, `show`, `main`, `remove`                       | everyone   | Link Battle.net and manage characters                |
| `/config channels`, `officers`, `hosts`, `reminders`, `timezone`, `panel`, `show` | officers   | Server settings                                      |
| `/template add`, `edit`, `disable`, `enable`, `list`                              | officers   | Manage the dungeon and raid lists                    |

The bot starts with 20 dungeons and 7 raids.

## Setup

You need a Discord application, a Battle.net application, and a place to run the bot. The steps below are the short version; [docs/operations.md](docs/operations.md) explains each one in detail, including HTTPS, backups and updates.

### 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> and create an application.
2. Copy the **Application ID** (`DISCORD_APP_ID`).
3. On the **Bot** page, reset and copy the token (`DISCORD_TOKEN`). Leave all privileged intents off.
4. Under **OAuth2 → URL Generator**, tick the scopes `bot` and `applications.commands` and these permissions: View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Read Message History.
5. Open the generated URL and add the bot to your server.
6. Copy your server ID (`GUILD_ID`): switch on Developer Mode in Discord, right-click the server icon, **Copy Server ID**.

### 2. Create the Battle.net application

1. Go to <https://develop.battle.net/access/clients> and create a client.
2. Set the redirect URL to your bot's public address followed by `/callback`, for example `https://bot.example.org/callback`. For a local run, use `http://localhost:3050/callback`.
3. Copy the client ID and secret (`BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`).

### 3. Fill in the settings

```sh
git clone https://github.com/brookflok/dungeon-raid-discord-bot.git
cd dungeon-raid-discord-bot
cp .env.example .env
```

Edit `.env`. Write each value directly after the `=`, without quotes.

| Variable                 | Meaning                                   | Default           |
| ------------------------ | ----------------------------------------- | ----------------- |
| `DISCORD_TOKEN`          | Bot token                                 |                   |
| `DISCORD_APP_ID`         | Application ID                            |                   |
| `GUILD_ID`               | Your Discord server ID                    |                   |
| `DATABASE_PATH`          | Where the SQLite file is stored           | `data/bot.sqlite` |
| `PUBLIC_URL`             | Public address of the bot, without a path |                   |
| `PORT`                   | Port of the bot's web server              | `3050`            |
| `BLIZZARD_CLIENT_ID`     | Battle.net client ID                      |                   |
| `BLIZZARD_CLIENT_SECRET` | Battle.net client secret                  |                   |
| `BLIZZARD_REGION`        | `eu`, `us`, `kr` or `tw`                  | `eu`              |

Never commit `.env`. It is excluded from git.

### 4. Run it

**With Docker (for a server):**

```sh
docker build -t guild-bot .
mkdir -p data && sudo chown 1000:1000 data
docker run -d --name guild-bot --restart unless-stopped \
  --env-file .env \
  -p 127.0.0.1:3050:3050 \
  -v "$(pwd)/data:/app/data" \
  guild-bot
```

Battle.net linking needs the bot to be reachable over HTTPS at `PUBLIC_URL`. Put a reverse proxy such as Caddy in front of port 3050; see [section 6 of the operations guide](docs/operations.md#6-https-with-a-reverse-proxy).

**Without Docker (for a local try-out, Node 24 or newer):**

```sh
npm ci
npm run build
node --env-file=.env dist/main.js
```

For a local run, set `PUBLIC_URL=http://localhost:3050`.

Run only one bot process per database file.

### 5. Configure the server in Discord

As a server administrator:

```
/config channels kind:dungeon channel:#dungeon-groups
/config channels kind:raid channel:#raids
/config channels kind:event channel:#events
/config officers role:@Officer action:add
/config channels kind:log channel:#activity-log
/config channels kind:officers channel:#officer-reports
/config panel kind:dungeon
/config panel kind:raid
/config panel kind:event
/config panel kind:all
/config hosts kind:raid role:@Raid Leader action:add
```

`/config panel` posts a box with buttons ("Start a dungeon group", "My characters", "Link Battle.net") in that kind's channel, so members do not need to know the slash commands. `/config panel kind:all` posts one box with "Host a dungeon", "Host a raid" and "Host an event" in the channel where you run it. `/config hosts` sets which roles may host a kind besides officers; without a host role, everyone can host dungeons and events and only officers can host raids. The bot registers its slash commands itself each time it starts.

The log channel is where finished groups are moved: the starter (or an officer) presses **Finish** on the post or in the group's thread, picks a result (completed, failed, did not happen) and can add a report. Groups nobody finishes are moved there 3 hours after their start with a mention of the starter and an **Add result** button. The officers channel should be visible to officers only: once it is set, the Finish form has a third field, "Private report to the officers", whose text is posted only there.

Check the result with `/config show`. The default timezone for typed times is `Europe/Berlin`; change it with `/config timezone`.

## Development

```sh
npm test          # run the tests
npm run lint      # ESLint and Prettier
npm run typecheck
```

The code is a modular monolith: `src/core` holds the rules with no Discord or database code, `src/modules` holds one module per feature, and `src/discord`, `src/storage`, `src/web` and `src/blizzard` connect the core to the outside. A new feature is a new module registered in `src/modules/index.ts`.

## Documentation

- [Operations guide](docs/operations.md): installation, HTTPS, backups, updates, manual test checklist
- [Architecture (arc42)](docs/architecture/arc42.md)
- [Requirements (req42)](docs/requirements/req42.adoc)

## Status

The automated tests pass. The manual test checklist in the operations guide has not yet been carried out against a live Discord server.

## License

[MIT](LICENSE)
