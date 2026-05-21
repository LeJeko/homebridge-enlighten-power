
<p align="center">
  <a href="https://github.com/homebridge/homebridge"><img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" height="140"></a>
</p>

<span align="center">

# homebridge-enlighten-power

[![npm](https://img.shields.io/npm/v/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![npm](https://img.shields.io/npm/dt/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![Homebridge v2 Ready](https://img.shields.io/badge/Homebridge-v2%20Ready-purple)](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0)

</span>

> 🌐 **English** · [Version française](README.fr.md)

> ⚠️ **Upgrading from 1.x?** Version 2.0.0 is a **breaking release**: local access now requires HTTPS + a Bearer token, and the Cloud API has moved to v4 with OAuth 2.0 (`client_id`, `client_secret`, `refresh_token` replace `api_user_id` and the legacy `site_id`). See the [CHANGELOG](CHANGELOG.md) for the full migration steps before running `npm update`.

## Description

This plugin simulates a CO2 air quality accessory that you can switch to the "detected" state when the power produced by your Envoy solar system reaches a threshold.  
You can use this state to automate other tasks or just to get information.  
Current power is not displayed directly, but appears in the accessory settings under "Current level" in [ppm], but the value is in [W].

It can talk to your Envoy in two ways:

- **Locally** over HTTPS — either via Bonjour (`envoy.localdomain`) or a custom URL. Recent firmwares (D8+) require a long-lived **Bearer token** generated at [entrez.enphaseenergy.com](https://entrez.enphaseenergy.com).
- **Via the Enphase Cloud API v4** — OAuth 2.0 with `client_id`/`client_secret` and a `refresh_token`. The plugin renews the short-lived access token automatically.

The local `/production.json` endpoint returns two production values: *inverters* and *eim*

```json
{"production":[
    {   "type":"inverters",
        "wNow":5007,
         ....},
    {   "type":"eim",
        "wNow":5766.563,
         ....}]
```

The plug-in reads the **eim** value by default but you can override this behavior by adding `"type": "inverters"` in config.json. This option only applies to the local modes (it is ignored for the Cloud API, which exposes a single `current_power` field).

Companion Python scripts in [`examples/`](examples/) extend the plugin beyond HomeKit by driving a **Piface2 relay** directly from a Raspberry Pi (e.g. to switch a boiler, an EV charger or any 230 V load when there is surplus solar). They read the same Envoy data and offer:

- two trigger modes — `--mode production` (relay ON when total production exceeds a threshold) or `--mode consumption` (relay ON when the house *exports* more than a given amount to the grid, with hysteresis to avoid oscillation);
- a configurable threshold via `--value <W>`;
- a choice of Piface relay (`--relay 0` or `--relay 1`, default 0) so a single Pi can pilot two independent loads;
- both access methods: local Envoy (HTTPS + Bearer token) and Cloud API v4 (OAuth, with automatic refresh-token handling and an interactive first-run setup).

Typical use: run them every minute via cron alongside Homebridge — HomeKit gets the on/off state through the plugin, the relay physically actuates the load.

## Local access (firmware D8+)

Recent Envoy firmwares require **HTTPS** with a **Bearer token** for any local access:

- The local hostname is now `envoy.localdomain` (was `envoy.local`).
- A long-lived JWT token must be sent in the `Authorization` header.
- The Envoy uses a self-signed certificate (the plugin disables strict TLS verification for local connections).

### Get your local token

Generate a long-lived token from your Enphase account:

[https://entrez.enphaseenergy.com](https://entrez.enphaseenergy.com)

## Bonjour

Example config.json for Bonjour ([https://envoy.localdomain/production.json](https://envoy.localdomain/production.json)):

```json
"accessories": [
        {
        "accessory": "enlighten-power",
        "name": "> 6000 W",
        "connection": "bonjour",
        "token": "eyJraWQiOiI......biQETMEQ",
        "type": "eim",
        "update_interval": 1,
        "power_threshold": 6000
        }
]
```

## Custom url

Example config.json for custom url:

```json
 "accessories": [
        {
        "accessory": "enlighten-power",
        "name": "> 6000 W",
        "url": "https://envoy_ip/production.json",
        "token": "eyJraWQiOiI......biQETMEQ",
        "type": "inverters",
        "update_interval": 1,
        "power_threshold": 6000
        }
]
```

## API (v4)

The plugin uses the Enphase **v4 API** with OAuth 2.0. Plans and limits: [https://developer-v4.enphase.com/plans](https://developer-v4.enphase.com/plans).  
The Watt plan allows 10'000 requests/month, so a 5 minute refresh stays within budget (12 * 24 * 31 = 8928).

### Step 1 — Create the application

Create an application at [https://developer-v4.enphase.com](https://developer-v4.enphase.com). The application page shows:

- **API Key**
- **Client ID**
- **Client Secret**
- **Authorization URL**, of the form:  
  `https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID`

You also need your **System ID** (the numeric ID of your Enlighten system, formerly called *site_id*).

### Step 2 — Get an authorization code

> ⚠️ The Authorization URL shown in the developer portal is **incomplete** — it lacks the `redirect_uri` parameter. If you open it as-is you will get:  
> `OAuth Error: error="invalid_request", error_description="A redirect_uri must be supplied."`

Append `&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri` to your Authorization URL before opening it:

```
https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri
```

Open that URL in a browser. Log in to Enlighten and approve the application. You are redirected to a page that displays a short, one-time **authorization code** (e.g. `2TJk7M`). The code is valid for only a few minutes — use it right away.

The `redirect_uri` value must match **exactly** at step 3 below (same string, same case).

### Step 3 — Exchange the code for a refresh_token

The refresh token is **not** displayed in the developer portal — you must generate it once with the code from step 2.

Either with curl:

```bash
curl -X POST \
  -u "CLIENT_ID:CLIENT_SECRET" \
  "https://api.enphaseenergy.com/oauth/token?grant_type=authorization_code&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri&code=AUTH_CODE"
```

or with the helper script [`examples/get_refresh_token.py`](examples/get_refresh_token.py): fill in `CLIENT_ID` and `CLIENT_SECRET` once, then pass the authorization code as argument:

```bash
python3 examples/get_refresh_token.py 2TJk7M
```

The JSON response looks like:

```json
{
  "access_token": "unique_access_token",
  "token_type": "bearer",
  "refresh_token": "unique_refresh_token",
  "expires_in": 86400,
  "scope": "read write",
  "enl_uid": "1234567",
  "enl_cid": "8449377baa266c7d944208676ea2ec37",
  "enl_password_last_changed_at": "1631234567",
  "is_internal_app": false,
  "app_type": "system",
  "jti": "abc123"
}
```

- `access_token` → valid 1 day. Used as `Authorization: Bearer …` on each API call.
- `refresh_token` → valid ~1 month. **This is the value to copy into `config.json`.** The plugin uses it to renew the access token automatically. When it expires (~1 month), repeat steps 2-3.

### Step 4 — config.json for the API

```json
"accessories": [
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
]
```

## Bonus: ask with curl

You can ask the current power produced with this one line command (replace `TOKEN`):

```bash
curl -sk -H "Authorization: Bearer TOKEN" "https://envoy.localdomain/production.json" | python3 -c "import sys, json; print(json.load(sys.stdin)['production'][1]['wNow'])"
```

Result:

```bash
5788.47
```

## Bonus: Python script and Piface2

In my case, I execute this script every minute to activate my boiler via Piface2 extension board based on current production and consumption.

#### Install pifacedigitalio
Thanks to @rfennel who have manage to [get it working](https://github.com/piface/pifacedigitalio/issues/39#issuecomment-633291166) with Buster:

1. Get PIP (PIP3 for Python3)
   `sudo apt-get install python3-pip`
2. Get the libraries
   `sudo pip3 install pifacedigitalio`
   `sudo pip3 install pifacecommon`
3. Make sure the SPI access is enabled to the IO (you get errors when you run the script if you miss this out)
   `sudo sed -i 's/#dtparam=spi=on/dtparam=spi=on/' /boot/config.txt`
4. Reboot
   `sudo reboot`

Ready-to-use scripts live in the [`examples/`](examples/) folder. Edit the constants at the top of each file, then run it with `python3 <script>.py`. `examples/refresh_token.txt` is gitignored — keep it private.

### [`examples/check_power_local.py`](examples/check_power_local.py)

Local Envoy access (HTTPS + Bearer token). Reads production and consumption from `/ivp/meters/readings` and drives one or both Piface2 relays.

**CLI options**

- `--mode production --value <W>`  
  Relay ON when total production ≥ `<W>`, OFF otherwise.
- `--mode consumption --value <W>`  
  Relay ON when the house exports more than `<W>` W to the grid; OFF as soon as the house imports from the grid (hysteresis to avoid oscillation).
- `--relay {0,1} [{0,1} ...]`  
  Piface relay index(es) to drive. Defaults to `0`. Pass `--relay 0 1` to mirror the action on both relays.

### [`examples/check_power_api.py`](examples/check_power_api.py)

Cloud API v4 access — **self-sufficient**:

- On first run, prints the Enphase Authorization URL and prompts you for the one-time authorization code returned by the browser redirect.
- Exchanges that code for a `refresh_token`, saved next to the script in `refresh_token.txt` (mode 600).
- On subsequent runs, reuses the stored `refresh_token` and only renews the short-lived access token automatically.
- If the `refresh_token` is rejected (expired ~1 month later), the script asks for a new authorization code and refreshes the file.

> Cron tip: the interactive prompt requires a TTY, so make sure `refresh_token.txt` already exists before scheduling it.

### [`examples/get_refresh_token.py`](examples/get_refresh_token.py)

Optional standalone helper for the same OAuth exchange. Useful when you only need a `refresh_token` to paste into Homebridge's `config.json` (and don't want the Piface logic).

**Usage**

```bash
python3 examples/get_refresh_token.py <AUTH_CODE>
```

Prints the `refresh_token` to stdout, ready to copy.

#### cron example
Launch cron editor
```shell
crontab -e
```
Execute the local script every minute (pick one of the two modes; `--relay` defaults to 0 if omitted, or pass `--relay 0 1` to drive both):
```
# m h  dom mon dow   command
# Production mode — relay 0 ON when production ≥ 6000 W
* * * * * python3 /home/pi/check_power_local.py --mode production --value 6000

# Consumption mode — relay 1 ON when exporting more than 4500 W to the grid
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 1

# Mirror both relays on consumption export
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 0 1
```
