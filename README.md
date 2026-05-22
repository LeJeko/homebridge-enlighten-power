
<p align="center">
  <a href="https://github.com/homebridge/homebridge"><img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" height="140"></a>
</p>

<span align="center">

# homebridge-enlighten-power

[![npm](https://img.shields.io/npm/v/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![npm](https://img.shields.io/npm/dt/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![Homebridge v2 Ready](https://img.shields.io/badge/Homebridge-v2%20Ready-purple)](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0)

</span>

> 🌐 **English** · [Version française](README.fr.md)

> ⚠️ **Upgrading from 1.x?** Version 2.0.0 was a breaking release: local access now requires HTTPS + a Bearer token, and the Cloud API moved to v4 with OAuth 2.0 (`client_id`, `client_secret`, `refresh_token` replace `api_user_id` and the legacy `site_id`). See the [CHANGELOG](CHANGELOG.md) before running `npm update`.

## Description

This Homebridge plugin exposes the power produced by your Enphase Envoy as a single HomeKit accessory. When production reaches a configurable threshold, the accessory switches to its triggered state (`detected` / `motion` / `occupied` / `open` / a lux value, depending on the type you pick) — useful as an event source for HomeKit automations.

Three connection methods are supported — see [The Homebridge plugin](#the-homebridge-plugin) below. The repository also ships three standalone [Python scripts](#companion-python-scripts) that drive a Piface2 relay from a Raspberry Pi — these are **completely independent of Homebridge** and exist for users who want to physically switch a 230 V load based on Envoy data.

---

## The Homebridge plugin

### Installation

- **Recommended:** install through the Homebridge UI — *Plugins* tab → search **Homebridge Enlighten Power** → *Install*.
- **Manual:** `npm install -g homebridge-enlighten-power`.

### Choose a connection method

| # | Method | Pros | Cons |
| - | --- | --- | --- |
| **1** | [Local + **static token**](#method-1--local--static-token) | Simple, fastest setup. | Manual token rotation ~once a year. |
| **2** | [Local + **auto-refreshed token**](#method-2--local--auto-refresh) | No manual rotation ever. | Your Enlighten password sits in `config.json`. |
| **3** | [**Cloud API v4** (OAuth 2.0)](#method-3--cloud-api-v4) | Works without LAN access to the Envoy. | 10 000 requests/month quota; one-time OAuth setup. |

All three methods share the same [`accessory_type`](#homekit-accessory-type), `power_threshold` and `update_interval` settings.

> In the Homebridge UI, the *Connection* dropdown handles method 3 vs. the local methods, and an *Authentication method* dropdown (`auth_method` in the JSON) handles method 1 vs. method 2. Only the relevant credential fields are shown. If you edit `config.json` by hand you can skip `auth_method` and just fill the fields you need — the plugin infers the method (with `token` winning if both are set).

---

### Method 1 — Local + static token

Local HTTPS access using a long-lived JWT that you generate yourself, **once**.

#### 1. Generate the token

1. Open <https://entrez.enphaseenergy.com> and log in.
2. Generate a token for your Envoy (the tool asks for the Envoy serial number).
3. Copy the JWT into `config.json` (see below). It expires after ~1 year — you will need to repeat the process when that happens.

#### 2. config.json — Bonjour (no need to specify the URL)

```json
{
  "accessory": "enlighten-power",
  "name": "> 6000 W",
  "connection": "bonjour",
  "token": "eyJraWQiOiI......biQETMEQ",
  "type": "eim",
  "update_interval": 1,
  "power_threshold": 6000
}
```

#### 3. config.json — Custom URL (e.g. reach the Envoy by IP)

```json
{
  "accessory": "enlighten-power",
  "name": "> 6000 W",
  "connection": "url",
  "url": "https://envoy_ip/production.json",
  "token": "eyJraWQiOiI......biQETMEQ",
  "type": "inverters",
  "update_interval": 1,
  "power_threshold": 6000
}
```

> **About the local API.** `envoy.localdomain` is the new mDNS hostname used by recent firmware (D8+); replace any older `envoy.local` reference. The Envoy ships a self-signed certificate — the plugin disables strict TLS verification on local connections only. The `/production.json` endpoint returns two `wNow` values: `inverters` (raw inverter output) and `eim` (CT clamp). The plugin uses `eim` by default; set `"type": "inverters"` to pick the other one.

---

### Method 2 — Local + auto-refresh

Same local Envoy access as Method 1, but the plugin **obtains and renews the JWT for you**, transparently. Recommended if you want to set it and forget it.

Provide your Enlighten credentials and Envoy serial number in `config.json` (omit `token`):

```json
{
  "accessory": "enlighten-power",
  "name": "> 6000 W",
  "connection": "bonjour",
  "enlighten_user": "you@example.com",
  "enlighten_pass": "MY_ENLIGHTEN_PASSWORD",
  "envoy_serial": "1234XXXXXXXX",
  "type": "eim",
  "update_interval": 1,
  "power_threshold": 6000
}
```

What happens at runtime:

1. On startup the plugin logs in to `enlighten.enphaseenergy.com` with your credentials.
2. It asks `entrez.enphaseenergy.com` for a fresh JWT bound to your Envoy serial.
3. The JWT is cached in memory and re-used on every Envoy call.
4. When the JWT gets within 7 days of expiry — or after a `401` from the Envoy — a new JWT is fetched automatically.

> **Notes.** If you set both `token` and the `enlighten_*` fields, the static `token` wins. Your Enlighten password is stored in plain text in `config.json` — same trust level as the rest of your Homebridge config, but worth knowing.

Custom URL works the same way: switch to `"connection": "url"` and add a `"url"` field — keep the three `enlighten_*` fields.

---

### Method 3 — Cloud API v4

OAuth 2.0 access to the Enphase developer API. Use this when your Homebridge cannot reach the Envoy on the local network. Plans: <https://developer-v4.enphase.com/plans>. The Watt plan allows 10 000 requests/month — a 5 minute refresh stays within budget (12 × 24 × 31 = 8928).

#### Step 1 — Create the application

On <https://developer-v4.enphase.com>, create an application. The page exposes:

- **API Key**
- **Client ID**
- **Client Secret**
- **Authorization URL** of the form `https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID`

You also need your **System ID** (numeric Enlighten system ID, formerly *site_id*).

#### Step 2 — Get an authorization code

> ⚠️ The Authorization URL in the portal is **incomplete** — it lacks `redirect_uri`. Append `&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri`, otherwise you get `OAuth Error: A redirect_uri must be supplied.`

Full URL:

```
https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri
```

Open it, log in to Enlighten, approve. The redirect page shows a short, one-time code (e.g. `2TJk7M`), valid only a few minutes.

#### Step 3 — Exchange the code for a refresh_token

The refresh token is **not** shown anywhere in the portal — you mint it yourself, once.

With curl:

```bash
curl -X POST \
  -u "CLIENT_ID:CLIENT_SECRET" \
  "https://api.enphaseenergy.com/oauth/token?grant_type=authorization_code&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri&code=AUTH_CODE"
```

Or with the helper [`examples/get_refresh_token.py`](examples/get_refresh_token.py) (fill `CLIENT_ID` / `CLIENT_SECRET` once):

```bash
python3 examples/get_refresh_token.py 2TJk7M
```

Response:

```json
{
  "access_token": "...",
  "token_type": "bearer",
  "refresh_token": "...",
  "expires_in": 86400,
  "scope": "read write",
  ...
}
```

`refresh_token` is valid ~1 month — copy it into `config.json`. The plugin uses it to renew the 24h access token automatically. When the refresh token expires, repeat steps 2-3.

#### Step 4 — config.json

```json
{
  "accessory": "enlighten-power",
  "name": "> 6000 W",
  "connection": "api",
  "api_key": "API_KEY",
  "client_id": "CLIENT_ID",
  "client_secret": "CLIENT_SECRET",
  "system_id": "SYSTEM_ID",
  "refresh_token": "REFRESH_TOKEN",
  "update_interval": 5,
  "power_threshold": 6000
}
```

---

### HomeKit accessory type

`accessory_type` controls how the sensor appears in HomeKit. The same field works for all three connection methods.

| Value | HomeKit service | Behaviour |
| --- | --- | --- |
| `co2sensor` (default) | Carbon Dioxide sensor | Power in ppm + Detected flag above threshold. Historical behaviour. |
| `motion` | Motion sensor | "Motion" detected above threshold. |
| `occupancy` | Occupancy sensor | "Occupied" above threshold. |
| `contact` | Contact sensor | "Open" above threshold. |
| `lightsensor` | Light sensor | Power in lux (capped at 100 000). |

Example combining `lightsensor` with Method 1:

```json
{
  "accessory": "enlighten-power",
  "name": "Solar production",
  "connection": "bonjour",
  "token": "eyJraWQiOiI......biQETMEQ",
  "accessory_type": "lightsensor",
  "power_threshold": 6000
}
```

---

### Quick test from a shell

Local Envoy:

```bash
curl -sk -H "Authorization: Bearer TOKEN" "https://envoy.localdomain/production.json" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['production'][1]['wNow'])"
```

Outputs the current `eim` production, e.g. `5788.47`.

---

## Companion Python scripts

The repository also ships three standalone Python scripts under [`examples/`](examples/). They are **independent of Homebridge** — they exist for users who want to drive a **Piface2 relay** directly from a Raspberry Pi (boiler, EV charger, any 230 V load) based on Envoy data, in parallel with HomeKit automations.

You can completely ignore this section if you only use the Homebridge plugin.

### Install pifacedigitalio

Thanks to @rfennel who [got it working](https://github.com/piface/pifacedigitalio/issues/39#issuecomment-633291166) under Buster:

```bash
sudo apt-get install python3-pip
sudo pip3 install pifacedigitalio pifacecommon
sudo sed -i 's/#dtparam=spi=on/dtparam=spi=on/' /boot/config.txt
sudo reboot
```

Edit the constants (`TOKEN` / `API_KEY` / `CLIENT_ID` / …) at the top of each script before running. `examples/refresh_token.txt` is gitignored — keep it private.

### [`examples/check_power_local.py`](examples/check_power_local.py)

Local Envoy access (HTTPS + Bearer token). Reads production and consumption from `/ivp/meters/readings` and drives one or both Piface2 relays.

**CLI options**

- `--mode production --value <W>` — relay ON when total production ≥ `<W>`, OFF otherwise.
- `--mode consumption --value <W>` — relay ON when the house exports more than `<W>` to the grid; OFF as soon as it imports (hysteresis to avoid oscillation).
- `--relay {0,1} [{0,1} ...]` — Piface relay index(es) to drive. Defaults to `0`. Pass `--relay 0 1` to mirror both.

### [`examples/check_power_api.py`](examples/check_power_api.py)

Cloud API v4 — **self-sufficient**:

- On first run prints the Enphase Authorization URL and prompts for the one-time authorization code returned by the browser redirect.
- Exchanges it for a `refresh_token`, saved next to the script in `refresh_token.txt` (mode 600).
- On subsequent runs reuses the stored `refresh_token` and renews the short-lived access token automatically.
- If the `refresh_token` is rejected (expired ~1 month later), the script asks for a new code and refreshes the file.

> Cron tip: the interactive prompt requires a TTY, so make sure `refresh_token.txt` already exists before scheduling it.

### [`examples/get_refresh_token.py`](examples/get_refresh_token.py)

Standalone helper for the OAuth exchange. Useful when you only need a `refresh_token` to paste into Homebridge's `config.json` and don't want the Piface logic.

```bash
python3 examples/get_refresh_token.py <AUTH_CODE>
```

Prints the `refresh_token` to stdout.

### cron example

```cron
# Production mode — relay 0 ON when production ≥ 6000 W
* * * * * python3 /home/pi/check_power_local.py --mode production --value 6000

# Consumption mode — relay 1 ON when exporting more than 4500 W
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 1

# Mirror both relays on consumption export
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 0 1
```
