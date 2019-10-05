# homebridge-enlighten-power

This plugin simulates a CO2 air quality accessory that you can switch to the "detected" state when the power produced by your Envoy solar system reaches a threshold.  
You can use this state to automate other tasks or just to get information.  
Current power is not displayed directly, but appears in the accessory settings under "Current level" in [ppm], but it is [W].

It can work locally (with Bonjour or custom url) or via API.

## Bonjour

Example config.json for Bonjour (`http://envoy.local/production.json`):

```json
"accessories": [
        {
        "accessory": "enlighten-power",
        "name": "> 6000 W",
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
        "url": "http://envoy_ip/production.json",
        "update_interval": 1,
        "power_threshold": 6000
        }
]
```

## API

Please note that API data is updated only every 15 minutes and access is limited:: [https://developer.enphase.com/plans](https://developer.enphase.com/plans)  
The free plan allowing to make 10'000 requests per month, by default it refreshes every 5 minutes (12 * 24 * 31 = 8928).

Example config.json for API:

```json
"accessories": [
        {
        "accessory": "enlighten-power",
        "name": "> 6000 W",
        "connection": "api",
        "api_key": "API_KEY",
        "api_user_id": "USER_ID",
        "site_id": "SITE_ID",
        "update_interval": 5,
        "power_threshold": 6000
        }
]
```

## Bonus: aks with Python

You can ask the current power produced with this one line command:

```bash
curl -s "http://envoy.local/production.json" | python -c "import sys, json; print json.load(sys.stdin)['production'][1]['wNow']"
```

Result:

```bash
5788.47
```

## Bonus: Python script and Piface2

In my case, I execute this script every minute to activate my boiler via  Piface2 extension board when level of production reach 6000 W.

*check_power_local.py*

```python
import sys
import requests
import json
import pifacedigitalio

response = requests.get('http://envoy.local/production.json')
data = response.json()
current_power = data['production'][1]['wNow']

if isinstance(current_power, float):

pfd = pifacedigitalio.PiFaceDigital(init_board=False)
state = pfd.relays[0].value

if (current_power >= 6000):
        if (state == 1):
                print (current_power, "W - Relay already ON")
        else:
                pfd.relays[0].turn_on()
                print(current_power, "W - Relay in now ON")
else:
        if (state == 0):
                print (current_power, "W - Relay already OFF")
        else:
                pfd.relays[0].turn_off()
                print(current_power, "W - Relay in now OFF")
else:
print("Error")

exit()
```

Same for API, replace API_KEY, USER_ID and SITE_ID values:

*check_power.py*

```python
import sys
import requests
import json
import pifacedigitalio

params = (
('key', 'API_KEY'),
('user_id', 'USER_ID'),
)

response = requests.get('https://api.enphaseenergy.com/api/v2/systems/SITE_ID/summary', params=params)
data = response.json()
current_power = data['current_power']

if isinstance(current_power, int):

pfd = pifacedigitalio.PiFaceDigital(init_board=False)
state = pfd.relays[0].value

if (current_power >= 6000):
        if (state == 1):
                print (current_power, "W - Relay already ON")
        else:
                pfd.relays[0].turn_on()
                print(current_power, "W - Relay in now ON")
else:
        if (state == 0):
                print (current_power, "W - Relay already OFF")
        else:
                pfd.relays[0].turn_off()
                print(current_power, "W - Relay in now OFF")
else:
print("Error")

exit()
```