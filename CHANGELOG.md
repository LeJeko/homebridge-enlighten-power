# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.3] — 2026-05-30

### Fixed

- README: removed remaining incorrect mentions of "local connections only" for `consumption` — the Cloud API supports it too via `latest_telemetry`.
- README: removed stale warning about `api` connection falling back to `production` for `consumption` accessories (that fallback no longer exists).
- README: removed redundant sentences about `consumption` availability in the Cloud API quota section.

---

## [3.0.2] — 2026-05-30

### Fixed

- Settings UI: accessories array layout fixed — all four fields now grouped in a single block per accessory; duplicate "Accessories" heading removed.
- Settings UI: `enlighten_pass` field masked as a password input.

---

## [3.0.1] — 2026-05-30

### Added

- **`consumption` measurement now available with Cloud API v4** — the plugin uses the `latest_telemetry` endpoint (production + consumption in a single call) instead of `/summary`.
- **Clock-aligned polling** — after the first poll at startup, subsequent polls fire at clock boundaries (e.g. every hour on the hour with `update_interval: 60`).

### Fixed

- Cloud API quota corrected from 10 000 to **1 000 requests/month** (Enphase reduced the free tier limit). Default `update_interval` updated to 60 min accordingly.
- Node.js engine requirement relaxed to `^18.15.0 || ^20.0.0 || ^22.0.0 || ^24.0.0`.

---

## [3.0.0] — 2026-05-30

> ⚠️ **Breaking change** — requires a clean uninstall before upgrading from 2.x. See the [migration guide](README.md#migrating-from-2x).

The plugin is now a **dynamic platform** (`"platform": "EnlightenPower"`). Config must be moved from the `accessories` section to the `platforms` section in `config.json`.

### Added

- **Dynamic platform** (`registerPlatform`): multiple HomeKit accessories sharing a single Envoy connection and a single OAuth/JWT token. One HTTP request per polling cycle regardless of the number of accessories.
- **`consumption` measurement** (local connections only): monitor the net grid exchange (`activePower` of the `net-consumption` CT) instead of — or alongside — production.
  - Hysteresis: `detected → 1` when net ≤ −threshold (exporting surplus); `detected → 0` when net ≥ 0 (importing). Same logic as `examples/check_power_local.py`.
  - Hidden automatically in the settings UI when Cloud API is selected.
- **Reliable CT identification via `/ivp/meters`**: at startup the plugin maps each meter's `eid` to its `measurementType` (`production`, `net-consumption`), then looks up readings by `eid` in `/ivp/meters/readings` — no positional assumptions on array order.
- **`accessories` array** in the platform config: each entry has `name`, `measurement`, `power_threshold`, and `accessory_type`.
- **Settings UI overhaul**: fields grouped into sections (*Connection*, *Local authentication*, *Cloud API credentials*); credentials displayed side-by-side; summary table in the header.

### Removed

- `registerAccessory` / `"accessory": "enlighten-power"` — platform only from now on.
- `type` field (`eim` / `inverters`): superseded by the `/ivp/meters` CT identification.

### Changed

- Local connections now call `/ivp/meters/readings` (instantaneous `activePower`) instead of `/production.json` (`wNow`).
- `url` field expects the **base URL** of the Envoy (e.g. `https://192.168.1.x`); a full URL with a path is still accepted and stripped automatically.
- `examples/check_power_local.py` updated to use the same `/ivp/meters` → `eid` → `/ivp/meters/readings` approach.

---

## [2.1.1] — 2026-05-22

UX polish on the 2.1.0 settings GUI — no runtime behaviour change for existing configs.

### Added

- New optional `auth_method` selector for local connection modes (`bonjour`, `url`):
  - `static_token` — only the `token` field is shown.
  - `auto_refresh` — only the `enlighten_user` / `enlighten_pass` / `envoy_serial` fields are shown.

  This makes the Homebridge plugin settings GUI adapt to the chosen method instead of always showing all four credential fields at once.

### Changed

- Documentation: README and `README.fr.md` rewritten to clearly separate the **Homebridge plugin** (with its three connection methods) from the **companion Python scripts** (independent of Homebridge, optional).
- When both `token` and `enlighten_*` fields are set, `auth_method` (if specified) is now the explicit tie-breaker. Without `auth_method`, the legacy precedence is preserved: `token` wins.

## [2.1.0] — 2026-05-22

Minor, **non-breaking** release. Existing 2.0.x configs keep working as-is.

### Added

- **Auto-refresh of the local Envoy token.** As an alternative to manually generating a JWT at <https://entrez.enphaseenergy.com> (which expires after ~1 year), you can now provide your Enlighten credentials in `config.json`:
  - `enlighten_user` — your Enlighten email
  - `enlighten_pass` — your Enlighten password
  - `envoy_serial` — the serial number of your Envoy / IQ Gateway

  The plugin then logs in to Enlighten, requests a fresh JWT from `entrez.enphaseenergy.com`, caches it in memory, and renews it transparently when it gets close to expiry (or after a `401` from the Envoy). The static `token` field still works and takes precedence if both are set.

- **Configurable HomeKit accessory type** via `accessory_type`:
  - `co2sensor` (default — historical behaviour: production in ppm + Detected flag)
  - `motion` — relay-like behaviour as a Motion sensor
  - `occupancy` — same as Motion, exposed as an Occupancy sensor
  - `contact` — Contact sensor, "open" when above threshold
  - `lightsensor` — exposes the current power directly as lux (capped at 100 000)

### Notes

- No config migration required. If you don't set `enlighten_user` / `enlighten_pass` / `envoy_serial`, the plugin keeps using your `token` exactly as before. If you don't set `accessory_type`, you stay on the CO2 sensor.

## [2.0.1] — 2026-05-21

### Changed

- `displayName` set to `Homebridge Enlighten Power` so the Homebridge plugin browser shows the prefixed name on the plugin card.

### Added

- `funding` field pointing to PayPal — activates the donation heart in the Homebridge plugin UI.

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
