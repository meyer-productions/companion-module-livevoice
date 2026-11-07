<p align="center">
  <img src="./assets/brand/readme-header-1280x300.png" alt="LiveVoice Remote" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/meyer-productions/companion-module-livevoice/actions/workflows/node.yaml">
    <img src="https://github.com/meyer-productions/companion-module-livevoice/actions/workflows/node.yaml/badge.svg" alt="CI status" />
  </a>
  <a href="./LICENSE.md">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
  </a>
  <a href="./companion/manifest.json">
    <img src="https://img.shields.io/badge/companion%20module-0.4.1-orange.svg" alt="Companion module version" />
  </a>
</p>

# LiveVoice Remote

A [Bitfocus Companion](https://bitfocus.io/companion) connection module for [LiveVoice](https://livevoice.io) -
starts/stops audio import and AI translation per channel and reads channel status and participant counts via the
official [LiveVoice Server API v2](https://livevoice.io/en/help/article/api) (PLUS plan, currently BETA).

> «LiveVoice» und das LiveVoice-Logo sind Marken der LiveVoice GmbH. Dieses Projekt ist ein unabhängiges
> Community-Modul, steht in keiner Verbindung zu LiveVoice und verwendet weder deren Logo noch deren Wortmarke
> als Produktname. Der API-Key wird ausschliesslich lokal in der Companion-Instanz gespeichert; es werden
> keine Audio-Daten, Event-Daten oder Zugangsdaten an Dritte übertragen.

## Features

- **Official API** - API key + event dropdown, no scraping of internal web client endpoints.
- **Rate-limit aware** - LiveVoice allows 60 requests/minute and 300/hour per IP; the module budgets its own
  polling and always keeps a reserve for button actions. Optional signed webhooks (`channel_state_changed`) for
  instant state changes.
- **Actions** - Start/Stop/Toggle Import, Start/Stop/Toggle AI translation, switch the original (source)
  language incl. all AI channels, switch the AI voice (male/female) for all AI channels, refresh. Toggles only act on an
  unambiguous server state, never guess.
- **Feedbacks driven by the real server state** - import active / inactive / offline / unknown, AI running, raw
  channel state, connection status and a participant-count comparator.
- **Variables** for event, channel, connection status, states, participant counts and API usage.
- **Ready-made presets** with the module's own key-style graphics, plus one AI toggle per AI channel.

Full reference for configuration, API limits, webhooks, actions, feedbacks, variables and presets:
[companion/HELP.md](./companion/HELP.md). [INFO.md](./INFO.md) contains the historical reverse-engineering notes of
the web client protocol used up to 0.3.x.

## Installation

1. Download the latest `.tgz` package from the [Releases](../../releases) page (or build it yourself, see
   below).
2. In Companion, go to **Modules → Import module package** and select the downloaded file.
3. Add a new "LiveVoice Remote" connection, enter your LiveVoice Server API key, save, reopen the config and pick
   the event.

## Known limitation

Companion does not currently carry a preset's own feedbacks over onto a button when the "LiveVoice Start &
Stop" preset is dragged onto it - the button's Feedbacks tab stays empty even though the preset defines them
correctly (elements and action steps _do_ transfer). This is a confirmed, currently open Companion bug -
[bitfocus/companion#4410](https://github.com/bitfocus/companion/issues/4410) - not a defect in this module.
Details and the exact one-time manual workaround are documented in
[companion/HELP.md](./companion/HELP.md#bekannte-einschränkung-stand-30082026-bestätigt-auf-companion-504).

## Development

This project uses TypeScript, [@companion-module/base](https://github.com/bitfocus/companion-module-base) and
Yarn 4.

```sh
yarn install       # install dependencies
yarn build         # compile once to dist/
yarn dev           # compile in watch mode
yarn test          # unit tests (state mapping, request budget, API errors, webhook signatures)
yarn smoke         # read-only check against the real API (needs LIVEVOICE_API_KEY in .env, never committed)
yarn lint          # eslint
yarn package       # build + produce the importable .tgz via companion-module-build
```

## Brand assets

[assets/brand/](./assets/brand/) contains the module's icon/logo/lockup set (colors, typography and usage in
[README-Assets.md](./assets/brand/README-Assets.md)) - open [preview.html](./assets/brand/preview.html) locally
to review all vector variants. `social-preview-1280x640.png` is uploaded under this repo's
**Settings → General → Social preview**.

## License

[MIT](./LICENSE.md)
