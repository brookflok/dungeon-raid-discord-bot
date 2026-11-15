# Operations Guide

This guide is for the person who installs and looks after the guild bot. It assumes no knowledge of the code. Follow the sections in order the first time: each one needs the result of the one before.

The bot is one Docker container. It connects to Discord, serves two web pages for the Battle.net login, and keeps all its data in one SQLite file. All settings come from environment variables.

## 1. What you need

- A Linux server with Docker installed, reachable from the internet.
- A domain name for the bot, for example `bot.example.org`, whose DNS record points at that server. In this guide, `https://bot.example.org` stands for your address; replace it everywhere.
- A reverse proxy on the server that serves HTTPS for that name. Section 6 shows one with Caddy.
- The `sqlite3` command-line tool on the server, for backups (`sudo apt-get install -y sqlite3` on Debian or Ubuntu).
- Administrator rights on the guild's Discord server.
- Access to the Blizzard developer account that owns the Battle.net application `dungeon-organization-guild`.

## 2. Create the Discord application

1. Open <https://discord.com/developers/applications>, click **New Application**, give it a name (for example "Guild Bot") and create it.
2. On the **General Information** page, copy the **Application ID**. This is the value for `DISCORD_APP_ID`.
3. Open the **Bot** page, click **Reset Token**, confirm, and copy the token. This is the value for `DISCORD_TOKEN`. Treat it like a password: whoever has it controls the bot. If it ever leaks, reset it again on this page and update the `.env` file.
4. On the same page, leave all **Privileged Gateway Intents** switched off. The bot does not need them.
5. Open **OAuth2**, then **URL Generator**. Under **Scopes**, tick `bot` and `applications.commands`. Under **Bot Permissions**, tick exactly these: View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Read Message History.
6. Copy the generated URL at the bottom of the page, open it in your browser, choose the guild's server and click **Authorize**. The bot now appears in the member list (offline until it runs).
7. Copy the server ID: in Discord, open **User Settings**, then **Advanced**, and switch on **Developer Mode**. Then right-click the server icon and choose **Copy Server ID**. This is the value for `GUILD_ID`.

If one of the channels the bot will post in has its own permission settings that hide it from most members, give the bot's role access to that channel as well.

## 3. Update the Blizzard application

The Battle.net application `dungeon-organization-guild` already exists. It needs two changes before the bot goes live.

1. Sign in at <https://develop.battle.net/access/clients> and open the client `dungeon-organization-guild`.
2. Change the redirect URL. Remove `http://localhost:3050/callback` and add your public address followed by `/callback`, for example `https://bot.example.org/callback`. In general it is `${PUBLIC_URL}/callback`, where `PUBLIC_URL` is the value from section 4. It must match exactly: `https`, the same host name, and no slash at the end. Battle.net refuses any login whose redirect URL is not on this list.
3. **Generate a new client secret.** The client secret that was used while the bot was designed was exposed, so it must not be used in production. Use the option on the client's page to generate a new secret and copy it. This is the value for `BLIZZARD_CLIENT_SECRET`. If the page offers no way to replace the secret, create a new client with the same settings and redirect URL and use its ID and secret instead.
4. Copy the **Client ID**. This is the value for `BLIZZARD_CLIENT_ID`.

## 4. Environment variables

The bot reads its settings from a file named `.env` in the bot's folder on the server. Get the code and create the file from the example:

```sh
sudo git clone <repository URL> /srv/guild-bot
sudo chown -R "$USER" /srv/guild-bot
cd /srv/guild-bot
cp .env.example .env
chmod 600 .env
```

Then edit `.env` and fill in the values. Write each value directly after the `=` without quotes, because Docker takes quotes literally.

| Variable | Meaning | Example or default |
|---|---|---|
| `DISCORD_TOKEN` | The bot token from section 2, step 3. | (secret) |
| `DISCORD_APP_ID` | The Application ID from section 2, step 2. | `123456789012345678` |
| `GUILD_ID` | The server ID from section 2, step 7. | `123456789012345678` |
| `DATABASE_PATH` | Where the SQLite file is stored. Keep the default with Docker: it lies inside the data volume. | `data/bot.sqlite` (default) |
| `PUBLIC_URL` | The public HTTPS address of the bot, without a path. Login links and the Battle.net redirect URL are built from it. | `https://bot.example.org` |
| `PORT` | The port of the bot's web server inside the container. | `3050` (default) |
| `BLIZZARD_CLIENT_ID` | The client ID from section 3, step 4. | |
| `BLIZZARD_CLIENT_SECRET` | The **new** client secret from section 3, step 3. | (secret) |
| `BLIZZARD_REGION` | The Battle.net region: `eu`, `us`, `kr` or `tw`. | `eu` (default) |

The bot checks every value when it starts. If one is missing or invalid, it stops with the message `Invalid environment, check:` followed by the names of the variables to fix.

Never commit `.env` or send it to anyone. It is excluded from git and from the Docker image.

## 5. Build and run with Docker

Run these commands in `/srv/guild-bot`.

1. Build the image:

   ```sh
   docker build -t guild-bot .
   ```

2. Create the data folder. Inside the container the bot runs as the user `node` with the user ID 1000, so the folder must belong to that ID:

   ```sh
   mkdir -p data
   sudo chown 1000:1000 data
   ```

3. Start the container:

   ```sh
   docker run -d --name guild-bot --restart unless-stopped \
     --env-file .env \
     -p 127.0.0.1:3050:3050 \
     -v /srv/guild-bot/data:/app/data \
     guild-bot
   ```

   The port is published on `127.0.0.1` only, so the bot's web server can be reached only through the reverse proxy on the same server. If you change `PORT` in `.env`, change both numbers after `-p` to match. `--restart unless-stopped` starts the bot again after a crash or a server reboot.

4. Watch the log:

   ```sh
   docker logs -f guild-bot
   ```

   Every log line is one JSON object with `level`, `msg`, `time` and further details. After a normal start you see `Templates seeded`, `Web server listening` and `Discord client ready`. Press Ctrl+C to stop watching; the bot keeps running. To list only errors, run `docker logs guild-bot 2>&1 | grep '"level":"error"'`. The logs never contain tokens or secrets.

   If the log shows `Discord login failed; check DISCORD_TOKEN`, the token in `.env` is wrong or was reset. A container keeps the values it was started with, so after fixing `.env` remove it with `docker rm -f guild-bot` and start it again with the command from step 3. The same applies to every later change to `.env`.

**Only one bot may use the database.** Never start a second container with the same data folder. Signups are put in order inside the one running process; two processes could put too many members into a group.

**Stopping.** `docker stop guild-bot` asks the bot to stop. It stops the reminder loop, closes the web server, disconnects from Discord and closes the database cleanly.

**Updating** to a new version of the code. Make a backup first (section 8), then run:

```sh
cd /srv/guild-bot
git pull
docker build -t guild-bot .
docker stop guild-bot
docker rm guild-bot
```

Then start it again with the `docker run` command from step 3. The bot registers its slash commands itself at every start. Database changes are applied automatically when the bot starts.

## 6. HTTPS with a reverse proxy

The bot's web server speaks plain HTTP. Battle.net sends members back to the bot over HTTPS, so a reverse proxy must receive HTTPS requests for your address and forward them to `127.0.0.1:3050`. The bot only serves two paths, `/link/…` and `/callback`; everything else answers "Not found."

The simplest choice is Caddy, which gets and renews the HTTPS certificate on its own.

1. Install Caddy as described on <https://caddyserver.com/docs/install>.
2. Replace the content of `/etc/caddy/Caddyfile` with:

   ```
   bot.example.org {
   	reverse_proxy 127.0.0.1:3050
   }
   ```

3. Reload Caddy:

   ```sh
   sudo systemctl reload caddy
   ```

4. Open `https://bot.example.org/` in a browser. A page saying "Not found." comes from the bot and shows that the proxy works.

Any other reverse proxy (nginx, Traefik, or the one your hosting provider offers) works the same way: HTTPS for the `PUBLIC_URL` host, forwarded to `127.0.0.1:3050`.

## 7. First run

1. Start the container (section 5) and wait for `Discord client ready` in the log.
2. The bot registers its slash commands itself: the log shows a `Slash commands registered` line listing `dungeon`, `raid`, `event`, `profile`, `config` and `template`. The commands are registered for the guild's server only, so they appear immediately; if they do not show up, restart the Discord app.
3. In Discord, as a server administrator (administrators always count as officers), choose the channel for each kind of post:

   ```
   /config channels kind:dungeon channel:#dungeon-groups
   /config channels kind:raid channel:#raids
   /config channels kind:event channel:#events
   ```

4. Name the officer role. Officers may post raids and change settings:

   ```
   /config officers role:@Officer action:add
   ```

5. Optional: change the timezone used for typed times (default `Europe/Berlin`) with `/config timezone zone:Europe/Berlin`, or the default reminders of a kind with `/config reminders kind:raid offsets:24h, 1h`.
6. Post the panel with buttons in each channel, so members can start without slash commands. The bot tries to pin it; give it the **Manage Messages** permission (or **Pin Messages**) if you want that:

   ```
   /config panel kind:dungeon
   /config panel kind:raid
   /config panel kind:event
   ```

7. Check everything with `/config show`. The dungeon and raid lists were filled automatically at the first start; `/template list kind:dungeon` and `/template list kind:raid` show them.

## 8. Daily backup

All of the bot's data is in one file, `/srv/guild-bot/data/bot.sqlite`. Back it up with the `.backup` command of `sqlite3`, which makes a consistent copy while the bot is running. Do not copy the file with `cp` while the bot runs; the copy may be broken.

1. Create a folder for the backups and make one backup by hand to check that it works:

   ```sh
   sudo mkdir -p /srv/guild-bot/backups
   cd /srv/guild-bot
   sudo sqlite3 data/bot.sqlite ".backup backups/bot-$(date +%F).sqlite"
   ls -l backups
   ```

2. Schedule it every night at 04:00 and keep 30 days. Open the root crontab with `sudo crontab -e` and add this line (in a crontab, `%` must be written as `\%`):

   ```
   0 4 * * * sqlite3 /srv/guild-bot/data/bot.sqlite ".backup /srv/guild-bot/backups/bot-$(date +\%F).sqlite" && find /srv/guild-bot/backups -name 'bot-*.sqlite' -mtime +30 -delete
   ```

3. Copy the backups folder to another machine from time to time. A backup on the same disk does not survive the loss of the server.

**Restoring a backup.** Stop the bot, put the backup in place (the date below is an example; use the backup you need), remove the database's temporary files (they belong to the old file and would damage the restored one), and start the bot again:

```sh
cd /srv/guild-bot
docker stop guild-bot
sudo cp backups/bot-2026-11-20.sqlite data/bot.sqlite
sudo rm -f data/bot.sqlite-wal data/bot.sqlite-shm
sudo chown 1000:1000 data/bot.sqlite
docker start guild-bot
```

## 9. Manual test checklist

The automated tests cover the rules, but not Discord itself. Carry out this list on a **test Discord server** before the bot goes live, and again after larger changes. None of it has been carried out yet. Write the date and the result next to each item when you check it.

Preparation: invite the bot to a test server and set `GUILD_ID` to that server's ID (a separate data folder keeps test data out of the real database). You need at least three test accounts besides your own. Run section 7 on the test server. Then create a small dungeon template so that two accounts fill a group:

```
/template add kind:dungeon name:Test pair tank:1 healer:0 dps:1
```

A count of 0 means the role is not part of the group: `Test pair` posts show only a Tank and a DPS line and button, and no Healer line.

Dungeon finder:

- [ ] `/template add` shows up in the form: `/dungeon start` (or the panel button **Start a dungeon group**) opens a form whose Dungeon dropdown offers `Test pair`.
- [ ] Start a dungeon with each time option. In the form pick `Test pair`, the role Tank, and as Day in turn: "As soon as possible" (the post says "As soon as possible"), "Flexible" (the post says "Flexible — time to be agreed"), "Today" with a later hour, "Tomorrow", and a later day. Each post appears in the dungeon channel as a card with the right time. "Today" with an hour that has passed is refused with "That time is in the past…". Cancel each group afterwards with the **Cancel group** button on the private confirmation.
- [ ] Character offer: an account without characters starts a group. The private confirmation offers **Link Battle.net** and **Add by name**; after adding a character by name, the post shows the character instead of the Discord name.
- [ ] Fill a group with test accounts: a second account clicks **DPS** on a `Test pair` post. A thread opens on the post with "✅ The group is full…" and a mention of both members, and both receive a direct message "✅ Your group … is full:" with a link to the post.
- [ ] Waitlist promotion: on the full group, a third account clicks **DPS** and is listed under Waitlist. The DPS member clicks **Leave**. The waitlisted account moves into the group, and the thread says "⬆️ … moved up from the waitlist and is now in the group."
- [ ] Leave when full, then refill: on a full group with nobody waiting, the DPS member clicks **Leave**; the post shows a free DPS slot again. Another account clicks **DPS**. The thread shows only "✅ The group is full again." and nobody receives a direct message.
- [ ] Direct messages disabled: one test account switches off direct messages from this server (server menu, **Privacy Settings**, **Direct Messages** off). A group with that account fills. The other member still receives the direct message, the thread mention arrives, and `docker logs guild-bot` shows no error for it.
- [ ] Deleted thread: delete the thread of a group, then trigger another notification for it (for example `/dungeon time when:tomorrow 21:00` as the starter). A new thread is created on the post with the message "🕐 New time: …".
- [ ] No thread permission: in the dungeon channel's permission settings, remove the bot's **Create Public Threads** permission, then fill a new `Test pair` group. No thread opens; "✅ The group is full…" and the mention of both members arrive as replies to the post, and both members still receive the direct message. Give the permission back afterwards.
- [ ] Deleted post: start a group with a `when` about 20 minutes ahead, delete its post in Discord, and click nothing. When the reminder is due (15 minutes before the start), the log shows an error line with `"msg":"publish: post"`, and the bot keeps working: starting another group still works.
- [ ] Closed group: a cancelled post shows "🚫 Cancelled" and no buttons. To check the answer to a late click, give a test account two characters (`/profile add` twice), let it click **Tank** or **DPS** on an open group so that the private character menu appears, cancel the group with `/dungeon cancel`, then pick a character in the menu. The answer is "This group is closed."

Raid finder:

- [ ] A member without the officer role runs `/raid post` and is refused with "Only officers can post raids."
- [ ] Tentative and Can't come: an officer posts a raid with `/raid post` (pick any raid and tomorrow 20:00). One account clicks **Tentative** and another **Can't come**; they are listed under "Tentative" and "Can't come". When one of them then clicks a role button, they move to that role.

Event planner:

- [ ] Unlimited event: `/event post` opens a form; fill in a title, pick a day and time, and leave "Maximum people" empty. The post shows "COMING 0/∞", has no waitlist section, and every account that clicks **Join** is listed.
- [ ] Capped event: `/event post` with "Maximum people" set to 2. The third account that clicks **Join** is put on the waitlist.

Reminders:

- [ ] 15-minute reminder: start a dungeon with a `when` about 20 minutes ahead. About 15 minutes before the start (within half a minute), the thread shows "⏰ Reminder: starts …" with a mention of the group.
- [ ] Restart before a reminder: start a dungeon with a `when` about 20 minutes ahead and run `docker restart guild-bot` before the reminder is due. The reminder still arrives on time.

Profiles:

- [ ] `/profile link` end to end with a real Battle.net account that has WoW Forever characters: the private reply contains a link; opening it leads to the Battle.net login; after logging in, the page says "Linked … characters. You can close this tab and return to Discord.", a direct message lists the characters, and `/profile show` shows them with "Battle.net account: linked."
- [ ] Reused link is refused: open the same link again and log in. The page says "That link is invalid or has expired. Use /profile link to get a new one."
- [ ] `/profile remove` deletes everything: run `/profile remove` without choosing a character and click **Remove everything**. The answer is "All your characters and your Battle.net link are removed.", and `/profile show` then says "No characters yet." and "Battle.net account: not linked."
