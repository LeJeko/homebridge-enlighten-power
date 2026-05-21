# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-05-21

> ⚠️ **Breaking release.** This version requires a `config.json` migration **and** an updated Envoy / Enphase setup. Homebridge will fail to load the accessory if you upgrade without adapting your configuration. Read the migration notes below before running `npm update`.

### Why the major bump

Enphase changed both the local and the cloud access in incompatible ways:

- The local Envoy (firmware D8+) now requires **HTTPS** with a **Bearer JWT token**, on the new hostname `envoy.localdomain` (was `envoy.local`).
- The Enphase Cloud API moved to **v4** with **OAuth 2.0** (access + refresh tokens). The legacy v2 query-string auth (`?key=...&user_id=...`) no longer works.

The plugin had to follow.

### Breaking changes

- **Local modes (`bonjour`, `url`)**
  - New required config field: `token` (long-lived JWT, generate at <https://entrez.enphaseenergy.com>).
  - The Bonjour URL now defaults to `https://envoy.localdomain/production.json` (was `http://envoy.local/production.json`).
  - Self-signed Envoy certificate accepted automatically (`rejectUnauthorized: false`).

- **API mode**
  - Removed: `api_user_id`, `site_id`.
  - Added (all required): `client_id`, `client_secret`, `system_id` (replaces `site_id`), `refresh_token`.
  - Endpoint switched from `/api/v2/systems/{site_id}/summary` to `/api/v4/systems/{system_id}/summary`.

- **Engines**
  - `engines.node`: `^22.12.0 || ^24.0.0` (was `>=0.12.0`).
  - `engines.homebridge`: `^1.6.0 || ^2.0.0` (now explicitly Homebridge 2.0 ready).

### Migration steps

1. **Local users**: generate a Bearer token at <https://entrez.enphaseenergy.com>, then add `"token": "<JWT>"` to your accessory config. Replace any `envoy.local` hostname with `envoy.localdomain`.
2. **Cloud API users**:
   - Create an application on <https://developer-v4.enphase.com> and note `API Key`, `Client ID`, `Client Secret`.
   - Run the OAuth Authorization Code flow once to obtain a `refresh_token` (see README — `examples/get_refresh_token.py` automates the exchange).
   - Replace `api_user_id` and `site_id` in your config with the new fields: `client_id`, `client_secret`, `system_id`, `refresh_token`.
3. Restart Homebridge.

### Added

- Cloud API v4 support with automatic access-token renewal from a stored `refresh_token`, in-memory caching, and forced refresh on `401`.
- Homebridge 2.0 / HAP-NodeJS v1 readiness (modern `onGet`, `updateCharacteristic`).
- Companion Python scripts in [`examples/`](examples/):
  - `check_power_local.py` — pilots one or both Piface2 relays from local Envoy data, with `--mode production|consumption`, `--value <W>`, and `--relay 0 1` (mirror).
  - `check_power_api.py` — self-sufficient API v4 client (interactive OAuth bootstrap, persists `refresh_token.txt`).
  - `get_refresh_token.py` — standalone OAuth code → refresh_token helper.
- `README.fr.md` (French version).
- `.gitignore`, `.npmignore` via `files` field, gitignored `examples/refresh_token.txt`.

### Changed

- `index.js` rewritten in modern ES6+ (class, `const`/`let`, async/await, template literals, `"use strict"`).
- Polling architecture: `onGet` returns cached values; a single `setInterval` poll updates HomeKit via `updateCharacteristic` — avoids hammering the Cloud API on every HomeKit read.
- `package.json`: added `displayName`, `license`, `bugs`, `homepage`, `files` allow-list, `enphase` keyword.

### Fixed

- 401 responses on the v4 summary endpoint now invalidate the cached access token so the next poll forces a refresh, instead of waiting the full 24 h cache window.

## [1.1.3] — earlier releases

See git history.
