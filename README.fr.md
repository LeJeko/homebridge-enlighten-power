
<p align="center">
  <a href="https://github.com/homebridge/homebridge"><img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" height="140"></a>
</p>

<span align="center">

# homebridge-enlighten-power

[![npm](https://img.shields.io/npm/v/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![npm](https://img.shields.io/npm/dt/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![Homebridge v2 Ready](https://img.shields.io/badge/Homebridge-v2%20Ready-purple)](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0)

</span>

> 🌐 [English version](README.md) · **Français**

> ⚠️ **Mise à niveau depuis la 1.x ?** La version 2.0.0 introduit des changements non rétro-compatibles : l'accès local exige désormais HTTPS + un token Bearer, et l'API Cloud passe en v4 avec OAuth 2.0 (`client_id`, `client_secret`, `refresh_token` remplacent `api_user_id` et l'ancien `site_id`). Consultez le [CHANGELOG](CHANGELOG.md) avant de lancer `npm update`.

## Description

Ce plugin Homebridge expose la puissance produite par votre Envoy Enphase sous la forme d'un unique accessoire HomeKit. Quand la production atteint un seuil configurable, l'accessoire bascule dans son état déclenché (`détecté` / `mouvement` / `occupé` / `ouvert` / une valeur lux, selon le type choisi) — pratique comme source d'événement pour les automatisations HomeKit.

Trois méthodes de connexion sont supportées — voir [Le plugin Homebridge](#le-plugin-homebridge) ci-dessous. Le dépôt fournit aussi trois [scripts Python](#scripts-python-compagnons) autonomes qui pilotent un relais Piface2 depuis un Raspberry Pi — ils sont **complètement indépendants de Homebridge** et existent pour les utilisateurs qui veulent commuter une charge 230 V à partir des données de l'Envoy.

---

## Le plugin Homebridge

### Installation

- **Recommandé :** via l'interface Homebridge — onglet *Plugins* → recherche **Homebridge Enlighten Power** → *Install*.
- **Manuel :** `npm install -g homebridge-enlighten-power`.

### Choisir une méthode de connexion

| # | Méthode | Avantages | Inconvénients |
| - | --- | --- | --- |
| **1** | [Local + **token statique**](#méthode-1--local--token-statique) | Simple, configuration la plus rapide. | Rotation manuelle du token ~une fois par an. |
| **2** | [Local + **token auto-renouvelé**](#méthode-2--local--auto-refresh) | Plus jamais de rotation manuelle. | Mot de passe Enlighten stocké dans `config.json`. |
| **3** | [**API Cloud v4** (OAuth 2.0)](#méthode-3--api-cloud-v4) | Fonctionne sans accès LAN à l'Envoy. | Quota 10 000 req/mois ; mise en place OAuth ponctuelle. |

Les trois méthodes partagent les mêmes réglages [`accessory_type`](#type-daccessoire-homekit), `power_threshold` et `update_interval`.

> Dans l'interface Homebridge, le menu déroulant *Connection* gère la méthode 3 face aux méthodes locales, et un menu *Authentication method* (`auth_method` dans le JSON) gère la méthode 1 face à la méthode 2. Seuls les champs pertinents s'affichent. Si vous éditez `config.json` à la main, vous pouvez omettre `auth_method` et ne renseigner que les champs nécessaires — le plugin déduit la méthode (le `token` l'emporte si les deux groupes sont remplis).

---

### Méthode 1 — Local + token statique

Accès HTTPS local avec un JWT longue durée que vous générez vous-même, **une fois**.

#### 1. Générer le token

1. Ouvrir <https://entrez.enphaseenergy.com> et se connecter.
2. Générer un token pour votre Envoy (l'outil demande le numéro de série de l'Envoy).
3. Copier le JWT dans `config.json` (voir ci-dessous). Il expire au bout d'environ 1 an — il faudra alors recommencer la procédure.

#### 2. config.json — Bonjour (pas besoin d'URL)

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

#### 3. config.json — URL personnalisée (p. ex. accès par IP)

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

> **À propos de l'API locale.** `envoy.localdomain` est le nouveau nom mDNS utilisé par les firmwares récents (D8+) ; remplacez toute référence à `envoy.local`. L'Envoy fournit un certificat auto-signé — le plugin désactive la vérification TLS stricte uniquement pour les connexions locales. Le endpoint `/production.json` renvoie deux valeurs `wNow` : `inverters` (sortie brute des onduleurs) et `eim` (pince ampèremétrique). Le plugin lit `eim` par défaut ; `"type": "inverters"` pour basculer.

---

### Méthode 2 — Local + auto-refresh

Même accès local qu'à la méthode 1, mais le plugin **obtient et renouvelle le JWT pour vous**, automatiquement. Recommandé si vous voulez l'installer et l'oublier.

Fournissez vos identifiants Enlighten et le numéro de série de l'Envoy dans `config.json` (omettez `token`) :

```json
{
  "accessory": "enlighten-power",
  "name": "> 6000 W",
  "connection": "bonjour",
  "enlighten_user": "vous@example.com",
  "enlighten_pass": "MOT_DE_PASSE_ENLIGHTEN",
  "envoy_serial": "1234XXXXXXXX",
  "type": "eim",
  "update_interval": 1,
  "power_threshold": 6000
}
```

Ce qui se passe à l'exécution :

1. Au démarrage, le plugin se connecte à `enlighten.enphaseenergy.com` avec vos identifiants.
2. Il demande à `entrez.enphaseenergy.com` un JWT frais lié au numéro de série de votre Envoy.
3. Le JWT est mis en cache en mémoire et réutilisé à chaque appel de l'Envoy.
4. Quand le JWT arrive à moins de 7 jours d'expiration — ou après un `401` de l'Envoy — un nouveau JWT est récupéré automatiquement.

> **Notes.** Si vous définissez à la fois `token` et les champs `enlighten_*`, le `token` statique prime. Votre mot de passe Enlighten est stocké en clair dans `config.json` — même niveau de confiance que le reste de votre config Homebridge, mais utile à savoir.

L'URL personnalisée fonctionne pareil : passez à `"connection": "url"` et ajoutez le champ `"url"` — gardez les trois champs `enlighten_*`.

---

### Méthode 3 — API Cloud v4

Accès OAuth 2.0 à l'API développeur Enphase. À utiliser quand votre Homebridge ne peut pas joindre l'Envoy sur le réseau local. Plans : <https://developer-v4.enphase.com/plans>. Le plan Watt autorise 10 000 requêtes/mois — un rafraîchissement toutes les 5 minutes reste dans le budget (12 × 24 × 31 = 8928).

#### Étape 1 — Créer l'application

Sur <https://developer-v4.enphase.com>, créez une application. La page affiche :

- **API Key**
- **Client ID**
- **Client Secret**
- **Authorization URL**, de la forme `https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=VOTRE_CLIENT_ID`

Vous avez aussi besoin de votre **System ID** (identifiant numérique du système Enlighten, anciennement *site_id*).

#### Étape 2 — Obtenir un code d'autorisation

> ⚠️ L'Authorization URL du portail est **incomplète** — il manque `redirect_uri`. Ajoutez `&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri`, sinon vous obtenez `OAuth Error: A redirect_uri must be supplied.`

URL complète :

```
https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=VOTRE_CLIENT_ID&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri
```

Ouvrez-la, connectez-vous à Enlighten, approuvez. La page de redirection affiche un code court à usage unique (p. ex. `2TJk7M`), valable seulement quelques minutes.

#### Étape 3 — Échanger le code contre un refresh_token

Le refresh token **n'est pas** affiché dans le portail — vous le générez vous-même, une fois.

Avec curl :

```bash
curl -X POST \
  -u "CLIENT_ID:CLIENT_SECRET" \
  "https://api.enphaseenergy.com/oauth/token?grant_type=authorization_code&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri&code=AUTH_CODE"
```

Ou avec l'utilitaire [`examples/get_refresh_token.py`](examples/get_refresh_token.py) (renseignez `CLIENT_ID` / `CLIENT_SECRET` une fois) :

```bash
python3 examples/get_refresh_token.py 2TJk7M
```

Réponse :

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

`refresh_token` est valable ~1 mois — copiez-le dans `config.json`. Le plugin l'utilise pour renouveler l'access token 24h automatiquement. À son expiration, refaites les étapes 2-3.

#### Étape 4 — config.json

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

### Type d'accessoire HomeKit

`accessory_type` contrôle comment le capteur apparaît dans HomeKit. Même champ pour les trois méthodes de connexion.

| Valeur | Service HomeKit | Comportement |
| --- | --- | --- |
| `co2sensor` (défaut) | Capteur CO2 | Puissance en ppm + drapeau Détecté au-dessus du seuil. Comportement historique. |
| `motion` | Détecteur de mouvement | "Mouvement" détecté au-dessus du seuil. |
| `occupancy` | Détecteur de présence | "Occupé" au-dessus du seuil. |
| `contact` | Capteur de contact | "Ouvert" au-dessus du seuil. |
| `lightsensor` | Capteur de luminosité | Puissance en lux (plafonné à 100 000). |

Exemple combinant `lightsensor` avec la méthode 1 :

```json
{
  "accessory": "enlighten-power",
  "name": "Production solaire",
  "connection": "bonjour",
  "token": "eyJraWQiOiI......biQETMEQ",
  "accessory_type": "lightsensor",
  "power_threshold": 6000
}
```

---

### Test rapide depuis un shell

Envoy local :

```bash
curl -sk -H "Authorization: Bearer TOKEN" "https://envoy.localdomain/production.json" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['production'][1]['wNow'])"
```

Affiche la production `eim` courante, p. ex. `5788.47`.

---

## Scripts Python compagnons

Le dépôt fournit également trois scripts Python autonomes dans [`examples/`](examples/). Ils sont **indépendants de Homebridge** — ils existent pour les utilisateurs qui veulent piloter directement un **relais Piface2** depuis un Raspberry Pi (chauffe-eau, chargeur de VE, n'importe quelle charge 230 V) à partir des données de l'Envoy, en parallèle des automatisations HomeKit.

Vous pouvez ignorer complètement cette section si vous n'utilisez que le plugin Homebridge.

### Installer pifacedigitalio

Merci à @rfennel qui a [partagé la procédure](https://github.com/piface/pifacedigitalio/issues/39#issuecomment-633291166) sous Buster :

```bash
sudo apt-get install python3-pip
sudo pip3 install pifacedigitalio pifacecommon
sudo sed -i 's/#dtparam=spi=on/dtparam=spi=on/' /boot/config.txt
sudo reboot
```

Éditez les constantes (`TOKEN` / `API_KEY` / `CLIENT_ID` / …) en tête de chaque script avant de l'exécuter. `examples/refresh_token.txt` est gitignoré — gardez-le privé.

### [`examples/check_power_local.py`](examples/check_power_local.py)

Accès local à l'Envoy (HTTPS + token Bearer). Lit production et consommation depuis `/ivp/meters/readings` et pilote un ou deux relais Piface2.

**Options CLI**

- `--mode production --value <W>` — relais ON quand la production totale ≥ `<W>`, OFF sinon.
- `--mode consumption --value <W>` — relais ON quand la maison exporte plus de `<W>` vers le réseau ; OFF dès qu'elle importe (hystérésis pour éviter les oscillations).
- `--relay {0,1} [{0,1} ...]` — index(es) du/des relais Piface à piloter. Défaut : `0`. `--relay 0 1` actionne les deux relais en miroir.

### [`examples/check_power_api.py`](examples/check_power_api.py)

API Cloud v4 — **autonome** :

- Au premier lancement, affiche l'Authorization URL d'Enphase et demande le code d'autorisation à usage unique renvoyé par la redirection navigateur.
- Échange ce code contre un `refresh_token`, sauvé à côté du script dans `refresh_token.txt` (permissions 600).
- Aux lancements suivants, réutilise le `refresh_token` stocké et renouvelle automatiquement l'access token (durée 24 h).
- Si le `refresh_token` est rejeté (expiré ~1 mois plus tard), le script redemande un code d'autorisation et met à jour le fichier.

> Note cron : le prompt interactif exige un TTY, assurez-vous que `refresh_token.txt` existe déjà avant de planifier le script.

### [`examples/get_refresh_token.py`](examples/get_refresh_token.py)

Utilitaire autonome pour l'échange OAuth. Pratique si vous voulez uniquement un `refresh_token` à coller dans le `config.json` de Homebridge, sans la logique Piface.

```bash
python3 examples/get_refresh_token.py <CODE_AUTORISATION>
```

Affiche le `refresh_token` sur stdout.

### Exemple cron

```cron
# Mode production — relais 0 ON quand production ≥ 6000 W
* * * * * python3 /home/pi/check_power_local.py --mode production --value 6000

# Mode consommation — relais 1 ON quand export > 4500 W vers le réseau
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 1

# Les deux relais en miroir sur l'export
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 0 1
```
