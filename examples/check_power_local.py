"""
Local Envoy access (firmware D8+): HTTPS + Bearer token on envoy.localdomain.

Reads the /ivp/meters/readings endpoint then drives one or both Piface2 relays
according to one of two modes:

  --mode production --value <W>
      Turn the relay(s) ON when production >= value, OFF otherwise.
      Example: --mode production --value 6000

  --mode consumption --value <W>
      Turn the relay(s) ON when the house exports more than <value> W to the
      grid (i.e. activePower of the consumption CT is below -value),
      and OFF as soon as the house imports from the grid (activePower > 0).
      Example: --mode consumption --value 4500

  --relay {0,1} [{0,1} ...]
      Piface relay index(es) to drive. Pass several indexes to mirror the
      action on both relays. Default: 0.
      Examples: --relay 1
                --relay 0 1

Generate the long-lived JWT token from https://entrez.enphaseenergy.com
and paste it as TOKEN below.
"""

import argparse
import logging

TOKEN = 'eyJraWQiOiI......biQETMEQ'

parser = argparse.ArgumentParser(description='Drive Piface2 relay(s) from Envoy production or grid export.')
parser.add_argument('--mode', choices=['production', 'consumption'], required=True,
                    help='Trigger source: total production, or grid export (consumption CT).')
parser.add_argument('--value', type=float, required=True,
                    help='Threshold in W (positive number).')
parser.add_argument('--relay', type=int, choices=[0, 1], nargs='+', default=[0],
                    help='Piface relay index(es) to drive; "--relay 0 1" mirrors the action on both (default: 0).')
args = parser.parse_args()

import requests
import urllib3
import pifacedigitalio

# Envoy uses a self-signed certificate on local HTTPS access
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logging.basicConfig(filename='relay.log', level=logging.INFO, format='%(asctime)s - %(levelname)s: %(message)s')

headers = {
    'Accept': 'application/json',
    'Authorization': f'Bearer {TOKEN}'
}
BASE = 'https://envoy.localdomain'

meters = requests.get(f'{BASE}/ivp/meters', headers=headers, verify=False).json()
eid_production  = next((m['eid'] for m in meters if m['measurementType'] == 'production'),  None)
eid_consumption = next((m['eid'] for m in meters if m['measurementType'] == 'net-consumption'), None)

if eid_production is None or eid_consumption is None:
    logging.error("Compteur 'production' ou 'net-consumption' introuvable dans /ivp/meters")
    exit(1)

readings = requests.get(f'{BASE}/ivp/meters/readings', headers=headers, verify=False).json()
prod_entry = next((r for r in readings if r['eid'] == eid_production),  None)
cons_entry = next((r for r in readings if r['eid'] == eid_consumption), None)

if prod_entry is None or cons_entry is None:
    logging.error("Lecture introuvable dans /ivp/meters/readings pour les eids attendus")
    exit(1)

production  = prod_entry['activePower']
consumption = cons_entry['activePower']

if not isinstance(production, (float, int)) or not isinstance(consumption, (float, int)):
    logging.error("Error: invalid production/consumption values")
    exit(1)

pfd = pifacedigitalio.PiFaceDigital(init_board=False)
# de-duplicate while preserving order, in case '--relay 0 0' is given
relay_indexes = list(dict.fromkeys(args.relay))

for idx in relay_indexes:
    relay = pfd.relays[idx]
    state = relay.value

    if args.mode == 'production':
        if production >= args.value:
            if state == 1:
                logging.info(f"Prod: {production} W - Relay {idx} already ON")
            else:
                relay.turn_on()
                logging.info(f"Prod: {production} W - Relay {idx} is now ON")
        else:
            if state == 0:
                logging.info(f"Prod: {production} W - Relay {idx} already OFF")
            else:
                relay.turn_off()
                logging.info(f"Prod: {production} W - Relay {idx} is now OFF")

    else:  # consumption: hysteresis between -value (export) and 0 (import)
        if state == 0:
            if consumption < -args.value:
                relay.turn_on()
                logging.info(f"Prod: {production} W - Conso: {consumption} W - Relay {idx} is now ON")
            else:
                logging.info(f"Prod: {production} W - Conso: {consumption} W - Relay {idx} already OFF")
        else:
            if consumption > 0:
                relay.turn_off()
                logging.info(f"Prod: {production} W - Conso: {consumption} W - Relay {idx} is now OFF")
            else:
                logging.info(f"Prod: {production} W - Conso: {consumption} W - Relay {idx} already ON")

exit()
