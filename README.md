
<p align="center">
  <a href="https://github.com/homebridge/homebridge"><img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" height="140"></a>
</p>

<span align="center">

# homebridge-enlighten-power

[![npm](https://img.shields.io/npm/v/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![npm](https://img.shields.io/npm/dt/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![Homebridge v2 Ready](https://img.shields.io/badge/Homebridge-v2%20Ready-purple)](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0)

</span>

> 🌐 **English** · [Version française](README.fr.md)

> ⚠️ **Upgrading from 2.x?** Version 3.0.0 is a breaking release — the plugin is now a **dynamic platform**. See the [migration guide](#migrating-from-2x) below.

## Description

This Homebridge plugin exposes your Enphase Envoy solar system to HomeKit as one or more sensors. Each accessory monitors either **production** (solar generation) or **consumption** (net grid exchange), and switches to its triggered state when the value crosses a configurable threshold — useful as an event source for HomeKit automations.

All accessories share a single Envoy connection and a single authentication token. Three connection methods are supported. The repository also ships three standalone [Python scripts](#companion-python-scripts) that drive a Piface2 relay from a Raspberry Pi — **completely independent of Homebridge**.

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
| **3** | [**Cloud API v4** (OAuth 2.0)](#method-3--cloud-api-v4) | Works without LAN access to the Envoy. | Production only; 10 000 req/month quota; one-time OAuth setup. |

> In the Homebridge UI, the *Connection* dropdown handles method 3 vs. the local methods, and an *Authentication method* dropdown handles method 1 vs. method 2. If you edit `config.json` by hand you can skip `auth_method` and just fill the fields you need — the plugin infers the method (`token` wins if both groups are set).

---

### Method 1 — Local + static token

Local HTTPS access using a long-lived JWT that you generate yourself, **once**.

#### 1. Generate the token

1. Open <https://entrez.enphaseenergy.com> and log in.
2. Generate a token for your Envoy (the tool asks for the Envoy serial number).
3. Copy the JWT into `config.json` (see below). It expires after ~1 year — repeat the process when that happens.

#### 2. config.json

```json
{
  "platforms": [
    {
      "platform": "EnlightenPower",
      "name": "Enlighten Power",
      "connection": "bonjour",
      "token": "eyJraWQiOiI......biQETMEQ",
      "update_interval": 1,
      "accessories": [
        { "name": "> 6000 W production", "measurement": "production", "power_threshold": 6000 }
      ]
    }
  ]
}
```

Custom URL (reach Envoy by IP):

```json
{
  "platforms": [
    {
      "platform": "EnlightenPower",
      "name": "Enlighten Power",
      "connection": "url",
      "url": "https://192.168.1.x",
      "token": "eyJraWQiOiI......biQETMEQ",
      "update_interval": 1,
      "accessories": [
        { "name": "> 6000 W production", "measurement": "production", "power_threshold": 6000 },
        { "name": "Export > 4500 W",     "measurement": "consumption", "power_threshold": 4500 }
      ]
    }
  ]
}
```

> **About the local API.** `envoy.localdomain` is the mDNS hostname used by firmware D8+. The Envoy ships a self-signed certificate — the plugin disables strict TLS verification on local connections only. At startup the plugin calls `/ivp/meters` to map each meter's `eid` to its `measurementType` (`"production"` or `"net-consumption"`). Each polling cycle it calls `/ivp/meters/readings` and looks up entries by `eid` — not by array position.

---

### Method 2 — Local + auto-refresh

Same local Envoy access as Method 1, but the plugin **obtains and renews the JWT for you**, transparently.

```json
{
  "platforms": [
    {
      "platform": "EnlightenPower",
      "name": "Enlighten Power",
      "connection": "bonjour",
      "auth_method": "auto_refresh",
      "enlighten_user": "you@example.com",
      "enlighten_pass": "MY_ENLIGHTEN_PASSWORD",
      "envoy_serial": "1234XXXXXXXX",
      "update_interval": 1,
      "accessories": [
        { "name": "> 6000 W production", "measurement": "production", "power_threshold": 6000 }
      ]
    }
  ]
}
```

What happens at runtime:

1. On startup the plugin logs in to `enlighten.enphaseenergy.com` with your credentials.
2. It asks `entrez.enphaseenergy.com` for a fresh JWT bound to your Envoy serial.
3. The JWT is cached in memory and re-used on every poll.
4. When the JWT gets within 7 days of expiry — or after a `401` from the Envoy — a new JWT is fetched automatically.

---

### Method 3 — Cloud API v4

OAuth 2.0 access to the Enphase developer API. Use this when Homebridge cannot reach the Envoy on the local network. **Only the `production` measurement is available** (the Cloud API does not expose instantaneous net consumption).

Plans: <https://developer-v4.enphase.com/plans>. The Watt plan allows 10 000 requests/month — a 5-minute refresh stays within budget (12 × 24 × 31 = 8928).

#### Step 1 — Create the application

On <https://developer-v4.enphase.com>, create an application. The page exposes:

- **API Key** · **Client ID** · **Client Secret**
- **Authorization URL** of the form `https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID`

You also need your **System ID** (numeric Enlighten system ID, formerly *site_id*).

#### Step 2 — Get an authorization code

> ⚠️ The Authorization URL in the portal is **incomplete** — it lacks `redirect_uri`. Append `&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri`, otherwise you get `OAuth Error: A redirect_uri must be supplied.`

Full URL:

```text
https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri
```

Open it, log in to Enlighten, approve. The redirect page shows a short, one-time code (e.g. `2TJk7M`), valid only a few minutes.

#### Step 3 — Exchange the code for a refresh_token

```bash
curl -X POST \
  -u "CLIENT_ID:CLIENT_SECRET" \
  "https://api.enphaseenergy.com/oauth/token?grant_type=authorization_code&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri&code=AUTH_CODE"
```

Or with [`examples/get_refresh_token.py`](examples/get_refresh_token.py):

```bash
python3 examples/get_refresh_token.py 2TJk7M
```

Copy the `refresh_token` from the response — valid ~1 month. The plugin renews the 24h access token automatically.

#### Step 4 — config.json

```json
{
  "platforms": [
    {
      "platform": "EnlightenPower",
      "name": "Enlighten Power",
      "connection": "api",
      "api_key": "API_KEY",
      "client_id": "CLIENT_ID",
      "client_secret": "CLIENT_SECRET",
      "system_id": "SYSTEM_ID",
      "refresh_token": "REFRESH_TOKEN",
      "update_interval": 5,
      "accessories": [
        { "name": "> 6000 W production", "measurement": "production", "power_threshold": 6000 }
      ]
    }
  ]
}
```

---

### Accessories

Each accessory in the `accessories` array is an independent HomeKit sensor. All share the platform's connection and authentication.

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `name` | ✅ | — | Display name in HomeKit. Must be unique. |
| `measurement` | | `production` | `production` (solar generation) or `consumption` (net grid exchange — local only). |
| `power_threshold` | | `1000` | Trigger level in W. See below for per-measurement logic. |
| `accessory_type` | | `co2sensor` | HomeKit sensor type — see [HomeKit accessory type](#homekit-accessory-type). |

**Production mode** — triggers when `production ≥ threshold`; resets below.

**Consumption mode** (local connections only) — mirrors the hysteresis of the Piface scripts:

- `detected → 1` when `net ≤ −threshold` (house is exporting more than threshold to the grid).
- `detected → 0` when `net ≥ 0` (house is importing from the grid).
- The displayed level is the absolute grid exchange value in W.

> If a `consumption` accessory is configured with `connection: api`, the plugin logs a warning and falls back to `production`.

---

### HomeKit accessory type

| Value | HomeKit service | Behaviour |
| --- | --- | --- |
| `co2sensor` (default) | Carbon Dioxide sensor | Power in ppm + Detected flag above threshold. |
| `motion` | Motion sensor | Motion detected above threshold. |
| `occupancy` | Occupancy sensor | Occupied above threshold. |
| `contact` | Contact sensor | Open above threshold. |
| `lightsensor` | Light sensor | Power in lux (capped at 100 000). |

---

### Quick test from a shell

Local Envoy — meter readings:

```bash
curl -sk -H "Authorization: Bearer TOKEN" "https://envoy.localdomain/ivp/meters/readings" \
  | python3 -c "import sys, json; d=json.load(sys.stdin); print('prod', d[0]['activePower'], 'W  net', d[1]['activePower'], 'W')"
```

---

## Migrating from 2.x

> ⚠️ **Clean uninstall required.** Because the plugin type changed from `accessory` to `platform`, Homebridge generates UUIDs differently and the old cached accessory data will conflict. **Do not just update in place** — follow the steps below.

### Migration steps — via Homebridge UI

1. **Plugins tab → Homebridge Enlighten Power → Uninstall.** Confirm. This stops the child bridge and removes the plugin.
2. **Accessories tab** — if the old accessory is still listed, click the ⚙️ icon → *Remove accessory*. If the tab is empty or the accessory is gone, skip this step.
3. **Settings → Config** (JSON editor) — make sure the `"accessories"` array no longer contains any `"accessory": "enlighten-power"` block. Save.
4. **Settings → Homebridge Settings → Restart Homebridge** once to flush the accessory cache.
5. **Plugins tab → search "Homebridge Enlighten Power" → Install**, or from a terminal: `npm install -g homebridge-enlighten-power`.
6. **Configure** the plugin via its settings GUI or by editing `config.json` as shown below.
7. **Remove from HomeKit** if the accessory still appears as unresponsive in the Home app: long-press → *Remove accessory*.

### Migration steps — via terminal (advanced)

```bash
# 1. Uninstall
npm uninstall -g homebridge-enlighten-power

# 2. Clear the accessory cache
rm /homebridge/accessories/cachedAccessories
rm /homebridge/accessories/cachedAccessories.*.json 2>/dev/null

# 3. Reinstall
npm install -g homebridge-enlighten-power   # stable

# 4. Edit config.json, then restart Homebridge
```

### Config changes

The plugin is now a **platform** (`"platform": "EnlightenPower"`) instead of an accessory (`"accessory": "enlighten-power"`). Config must be moved from the `accessories` section to the `platforms` section.

**Before** (`config.json` — v2.x):

```json
{
  "accessories": [
    {
      "accessory": "enlighten-power",
      "name": "> 6000 W",
      "connection": "bonjour",
      "token": "...",
      "power_threshold": 6000,
      "accessory_type": "motion"
    }
  ]
}
```

**After** (`config.json` — v3.x):

```json
{
  "platforms": [
    {
      "platform": "EnlightenPower",
      "name": "Enlighten Power",
      "connection": "bonjour",
      "token": "...",
      "accessories": [
        {
          "name": "> 6000 W",
          "measurement": "production",
          "power_threshold": 6000,
          "accessory_type": "motion"
        }
      ]
    }
  ]
}
```

---

## Companion Python scripts

The repository also ships three standalone Python scripts under [`examples/`](examples/). They are **independent of Homebridge** — they exist for users who want to drive a **Piface2 relay** directly from a Raspberry Pi based on Envoy data.

### Install pifacedigitalio

Thanks to @rfennel who [got it working](https://github.com/piface/pifacedigitalio/issues/39#issuecomment-633291166) under Buster:

```bash
sudo apt-get install python3-pip
sudo pip3 install pifacedigitalio pifacecommon
sudo sed -i 's/#dtparam=spi=on/dtparam=spi=on/' /boot/config.txt
sudo reboot
```

### [`examples/check_power_local.py`](examples/check_power_local.py)

Local Envoy access (HTTPS + Bearer token). Reads production and consumption from `/ivp/meters/readings` and drives one or both Piface2 relays.

- `--mode production --value <W>` — relay ON when production ≥ value, OFF otherwise.
- `--mode consumption --value <W>` — relay ON when house exports more than value to the grid; OFF as soon as it imports (hysteresis).
- `--relay {0,1} [{0,1} ...]` — relay index(es). Default: `0`. Pass `--relay 0 1` to mirror both.

### [`examples/check_power_api.py`](examples/check_power_api.py)

Cloud API v4 — self-sufficient. Handles the full OAuth flow, stores the refresh token in `refresh_token.txt`, and renews the access token automatically.

### [`examples/get_refresh_token.py`](examples/get_refresh_token.py)

Standalone helper for the OAuth exchange.

```bash
python3 examples/get_refresh_token.py <AUTH_CODE>
```

### cron example

```cron
# Production mode — relay 0 ON when production ≥ 6000 W
* * * * * python3 /home/pi/check_power_local.py --mode production --value 6000

# Consumption mode — relay 1 ON when exporting more than 4500 W
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 1

# Mirror both relays
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 0 1
```
