"""
One-time helper: exchange an authorization code for a refresh_token.

Procedure:
  1. Open your Authorization URL in a browser (from developer-v4.enphase.com app page,
     don't forget &redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri),
     log in to Enlighten and approve. You will be redirected to a page that shows
     a short, one-time authorization code (e.g. "2TJk7M").
  2. Fill CLIENT_ID and CLIENT_SECRET below, then run:
         python3 get_refresh_token.py <AUTH_CODE>
  3. Copy the printed `refresh_token` into your Homebridge config.json.
     Refresh tokens last ~1 month; access tokens are renewed automatically by the plugin.
"""

import argparse
import sys
import requests

CLIENT_ID = 'CLIENT_ID'
CLIENT_SECRET = 'CLIENT_SECRET'

parser = argparse.ArgumentParser(description='Exchange an Enphase authorization code for a refresh_token.')
parser.add_argument('code', help='One-time authorization code from the Enphase OAuth redirect page')
args = parser.parse_args()

response = requests.post(
    'https://api.enphaseenergy.com/oauth/token',
    params={
        'grant_type': 'authorization_code',
        'redirect_uri': 'https://api.enphaseenergy.com/oauth/redirect_uri',
        'code': args.code,
    },
    auth=(CLIENT_ID, CLIENT_SECRET),
)

if response.status_code != 200:
    print(f"OAuth exchange failed: HTTP {response.status_code}")
    print("Response body:", response.text)
    sys.exit(1)

data = response.json()
refresh_token = data['refresh_token']

print("Paste this value as 'refresh_token' in your Homebridge config.json:\n")
print(refresh_token)
print(f"\n(refresh token valid ~30 days; access token valid {data.get('expires_in', '?')} s — the plugin renews it automatically)")
