# UI refresh: cards, forms and panels

Date: 2026-11-15. Approved by the owner in conversation.

## Why

After the first live test the owner wants the bot to feel like the well-known Discord bots: boxes instead of plain text, forms instead of typed options, and no need to remember slash commands.

## Goals

- Group posts are a detailed card (embed): time, starter, progress bar with the missing roles, one member per line under each role.
- Creating a group is one pop-up form with dropdowns. Day and time are dropdowns, because Discord has no calendar widget.
- A panel with buttons in each channel starts every flow; slash commands keep working.
- A member without a character is offered "Link Battle.net" or "Add by name" after their group is posted. The post updates once they do.
- Every bot reply (confirmations, errors, thread notices, direct messages) is a box.
- A push to `main` deploys to Coolify, and the bot registers its slash commands itself at start.

## Non-goals

- No change to the rules in `src/core` or to the database.
- No live counter on the panel.
- Typed times stay only on the `time` subcommands.

## Approaches considered

1. **Embeds and modal dropdowns (chosen).** The classic look of Raid-Helper and similar bots; supported by the installed discord.js; no data change.
2. **Step-by-step private panel with live preview.** More clicks; rejected by the owner in favour of one form.
3. **Components V2 containers.** Newer layout, but cannot be mixed with embeds and would change every message path; no benefit that the owner asked for.

## Design

- `src/discord/render.ts` returns an embed. Colour per kind; grey when closed. Waitlist, Tentative and Can't come sections appear only when someone is in them.
- `src/discord/notice.ts`: one helper for a small box, used for replies and errors.
- `src/discord/time-form.ts`: Day, Hour, Minute and half-hour Time dropdown fields and the function that turns their values into a time. Day lists "As soon as possible", "Flexible" (not for raids) and the next 14 days in the server timezone.
- Forms:
  - Dungeon: dungeon, role, day, hour, minute. Defaults: as soon as possible, 20:00.
  - Raid: raid, day, hour, minute, optional own role.
  - Event: title, description, day, time (30-minute steps 12:00 to 23:30), maximum people. The modal limit is five fields, so events use one time dropdown.
- `src/discord/posted.ts`: the private confirmation after posting with "Go to post", "Change time", "Cancel", and for members without a character "Link Battle.net" and "Add by name".
- `src/discord/manage.ts` (module `manage`): the "Change time" and "Cancel" buttons.
- `src/discord/relabel.ts`: after a link or a manual add that came from a confirmation, the member's signup on that activity is re-signed with the character label. The pending link-to-activity note is kept in memory only (a link lives 10 minutes).
- `src/discord/panel.ts` and `/config panel kind:`: posts the panel in the kind's channel and tries to pin it.
- Thread notices: one message with the mentions as text and the notice as an embed (further messages only above 80 mentions).
- At most 25 dungeons or raids fit a dropdown; with more, the first 25 by name are shown.

## Deployment

- GitHub webhook to Coolify's manual webhook endpoint with a shared secret.
- Fixed container name in Coolify, so the old container stops before the new one starts.
- `main.ts` registers the guild commands when the client is ready.
