# Changelog

All notable changes to this Companion module are documented here. Versions follow the module's
`package.json`/`companion/manifest.json` version field, which is bumped on every change per Companion's
requirement that a re-imported module have a new id+version pair.

## 0.4.0

- **Switched to the official LiveVoice Server API v2** (API key instead of operator link). The internal web
  client protocol (HTML discovery + ActionCable WebSocket) is gone, together with the `ws` and
  `node-html-parser` dependencies.
- New config: API key, event dropdown, status poll interval (default 30 s), participant-count interval
  (default 120 s, 0 = off), optional webhook receiver with HMAC-SHA256 signature check.
- Request budget that respects LiveVoice's limits (60/min, 300/h per IP), keeps a reserve for actions and backs
  off after a 429.
- New actions: Start/Stop/Toggle AI translation, refresh. New feedbacks: AI running, raw channel state.
  New variables: `channel_state`, `participant_url`, `event_listener_count`, `api_requests_last_hour`.
- AI toggle preset per AI channel.
- Existing action/feedback IDs unchanged; upgrade script adds the new config defaults. After updating, the API
  key must be entered and the event selected.

## 0.3.12

- Toggle preset ("LiveVoice Start & Stop") restored to four stacked state images
  (`bg-idle`/`bg-active`/`bg-offline`/`bg-unknown`) with `enabled` feedback overrides, matching the confirmed
  visual design.
- Documented the remaining Companion-side limitation (feedbacks not carried over when the preset is dragged
  onto a button - [bitfocus/companion#4410](https://github.com/bitfocus/companion/issues/4410)) with the exact
  one-time manual workaround.

## 0.3.9 – 0.3.11

- Investigated why module-defined feedbacks on the "Start & Stop" preset did not appear after dragging it onto
  a button, across several structural variants (stacked image layers, a single image element with
  `base64Image` swapping, a classic `simple`-style preset). Root-caused to the still-open Companion bug above;
  no preset structure avoids it.
- Added the `importInactive` feedback (covers both "inactive" and "offline") to the toggle preset; removed the
  overlapping `importOffline` feedback from that preset to avoid two feedbacks competing for the same image
  element at once.

## 0.3.8 and earlier

- Initial working module: operator-link-only configuration with automatic discovery of API key, client
  identifiers, join code and event/channel info from the operator page HTML.
- Long-lived ActionCable connection with reconnect/backoff and ping/pong keep-alive.
- Actions: Start Import, Stop Import, Toggle Import (toggle rejects on an unknown server state instead of
  guessing).
- Feedbacks and variables driven by real server state (`channel_updated`/`init_event`), not by the last command
  sent.
- Upgraded to `@companion-module/base` 2.1.3 for `layered` (graphics-overhaul) preset/button support.
- Brand identity (icons, logos, key-state button graphics) designed and wired into the presets.
