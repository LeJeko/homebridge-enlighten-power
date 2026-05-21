"""
Enphase v4 API access: read the system summary and drive a Piface2 relay.

First-run setup
---------------
Fill API_KEY, CLIENT_ID, CLIENT_SECRET, SYSTEM_ID below from your
developer-v4.enphase.com application page.

On first run the script prints the Enphase Authorization URL and waits for you
to paste the authorization code. It then exchanges the code for a refresh token
and stores it next to the script in `refresh_token.txt`. Subsequent runs reuse
that file and only renew the short-lived access token automatically.

When the refresh token eventually expires (~1 month), the script will detect
the rejection, prompt for a new code, and refresh `refresh_token.txt`.

Note: cron / non-interactive use requires a valid `refresh_token.txt` to exist
beforehand (the `input()` prompt cannot run without a TTY).
"""

import os
import sys
import requests
import pifacedigitalio

API_KEY = 'API_KEY'
CLIENT_ID = 'CLIENT_ID'
CLIENT_SECRET = 'CLIENT_SECRET'
SYSTEM_ID = 'SYSTEM_ID'

REDIRECT_URI = 'https://api.enphaseenergy.com/oauth/redirect_uri'
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(SCRIPT_DIR, 'refresh_token.txt')


def authorization_url():
    return (
        'https://api.enphaseenergy.com/oauth/authorize'
        f'?response_type=code&client_id={CLIENT_ID}'
        f'&redirect_uri={REDIRECT_URI}'
    )


def read_refresh_token():
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            value = f.read().strip()
            if value:
                return value
    return None


def save_refresh_token(token):
    with open(TOKEN_FILE, 'w') as f:
        f.write(token)
    os.chmod(TOKEN_FILE, 0o600)


def exchange_code_for_refresh_token():
    print('\nOpen this URL in a browser, log in to Enlighten and approve:')
    print(f'  {authorization_url()}')
    print('\nYou will be redirected to a page that shows a short authorization code.')
    code = input('Paste the authorization code here: ').strip()
    resp = requests.post(
        'https://api.enphaseenergy.com/oauth/token',
        params={
            'grant_type': 'authorization_code',
            'redirect_uri': REDIRECT_URI,
            'code': code,
        },
        auth=(CLIENT_ID, CLIENT_SECRET),
    )
    if resp.status_code != 200:
        print(f'OAuth exchange failed: HTTP {resp.status_code}')
        print('Response body:', resp.text)
        sys.exit(1)
    refresh_token = resp.json()['refresh_token']
    save_refresh_token(refresh_token)
    print(f'refresh_token saved to {TOKEN_FILE}')
    return refresh_token


def request_access_token(refresh_token):
    return requests.post(
        'https://api.enphaseenergy.com/oauth/token',
        params={'grant_type': 'refresh_token', 'refresh_token': refresh_token},
        auth=(CLIENT_ID, CLIENT_SECRET),
    )


refresh_token = read_refresh_token()
if not refresh_token:
    refresh_token = exchange_code_for_refresh_token()

token_resp = request_access_token(refresh_token)
if token_resp.status_code != 200:
    print(f'Refresh token rejected (HTTP {token_resp.status_code}): {token_resp.text}')
    print('Requesting a new authorization code...')
    refresh_token = exchange_code_for_refresh_token()
    token_resp = request_access_token(refresh_token)
    if token_resp.status_code != 200:
        print(f'OAuth refresh failed again: HTTP {token_resp.status_code}')
        print('Response body:', token_resp.text)
        sys.exit(1)

token_json = token_resp.json()
access_token = token_json['access_token']
# Refresh tokens may rotate — keep the latest one on disk
if 'refresh_token' in token_json and token_json['refresh_token'] != refresh_token:
    save_refresh_token(token_json['refresh_token'])

response = requests.get(
    f'https://api.enphaseenergy.com/api/v4/systems/{SYSTEM_ID}/summary',
    params={'key': API_KEY},
    headers={'Authorization': f'Bearer {access_token}'},
)
if response.status_code != 200:
    print(f'Summary request failed: HTTP {response.status_code}')
    print('Response body:', response.text)
    sys.exit(1)

data = response.json()
current_power = data['current_power']

if isinstance(current_power, int):

    pfd = pifacedigitalio.PiFaceDigital(init_board=False)
    state = pfd.relays[0].value

    if current_power >= 6000:
        if state == 1:
            print(current_power, "W - Relay already ON")
        else:
            pfd.relays[0].turn_on()
            print(current_power, "W - Relay in now ON")
    else:
        if state == 0:
            print(current_power, "W - Relay already OFF")
        else:
            pfd.relays[0].turn_off()
            print(current_power, "W - Relay in now OFF")
else:
    print("Error")

exit()
