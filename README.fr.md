
<p align="center">
  <a href="https://github.com/homebridge/homebridge"><img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" height="140"></a>
</p>

<span align="center">

# homebridge-enlighten-power

[![npm](https://img.shields.io/npm/v/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![npm](https://img.shields.io/npm/dt/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![Homebridge v2 Ready](https://img.shields.io/badge/Homebridge-v2%20Ready-purple)](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0)

</span>

> 🌐 [English version](README.md) · **Français**

> ⚠️ **Mise à niveau depuis la 1.x ?** La version 2.0.0 introduit des **changements non rétro-compatibles** : l'accès local exige désormais HTTPS + un token Bearer, et l'API Cloud passe en v4 avec OAuth 2.0 (`client_id`, `client_secret`, `refresh_token` remplacent `api_user_id` et l'ancien `site_id`). Consultez le [CHANGELOG](CHANGELOG.md) pour la procédure de migration complète avant de lancer `npm update`.

## Description

Ce plugin simule un accessoire de qualité d'air CO2 qui bascule en état « détecté » dès que la puissance produite par votre système solaire Envoy dépasse un seuil.  
Vous pouvez utiliser cet état pour déclencher d'autres automatisations ou simplement comme indicateur.  
La puissance courante n'est pas affichée directement mais apparaît dans les réglages de l'accessoire sous « Niveau courant » exprimé en [ppm] — la valeur réelle est en [W].

Le plugin peut dialoguer avec votre Envoy de deux manières :

- **En local** en HTTPS — soit via Bonjour (`envoy.localdomain`), soit via une URL personnalisée. Les firmwares récents (D8+) exigent un **token Bearer** longue durée à générer sur [entrez.enphaseenergy.com](https://entrez.enphaseenergy.com).
- **Via l'API Cloud v4 d'Enphase** — OAuth 2.0 avec `client_id`/`client_secret` et un `refresh_token`. Le plugin renouvelle automatiquement l'access token (durée 24 h).

Le endpoint local `/production.json` renvoie deux valeurs de production : *inverters* et *eim*

```json
{"production":[
    {   "type":"inverters",
        "wNow":5007,
         ....},
    {   "type":"eim",
        "wNow":5766.563,
         ....}]
```

Par défaut le plugin lit la valeur **eim** ; on peut forcer l'autre source en ajoutant `"type": "inverters"` dans `config.json`. Cette option ne s'applique qu'aux modes locaux (elle est ignorée par le mode Cloud, qui expose un unique champ `current_power`).

Les scripts Python compagnons dans [`examples/`](examples/) étendent le plugin au-delà de HomeKit en pilotant directement un **relais Piface2** depuis un Raspberry Pi (p. ex. activer un chauffe-eau, un chargeur de VE ou n'importe quelle charge 230 V quand il y a un surplus solaire). Ils lisent les mêmes données Envoy et proposent :

- deux modes de déclenchement — `--mode production` (relais ON quand la production totale dépasse un seuil) ou `--mode consumption` (relais ON quand la maison *exporte* plus que le seuil vers le réseau, avec hystérésis pour éviter les oscillations) ;
- un seuil paramétrable via `--value <W>` ;
- un choix du relais Piface (`--relay 0` ou `--relay 1`, défaut 0) pour piloter deux charges indépendantes depuis un seul Pi ;
- les deux modes d'accès : Envoy local (HTTPS + token Bearer) et API Cloud v4 (OAuth, avec gestion automatique du refresh token et configuration interactive au premier lancement).

Usage typique : lancement par cron toutes les minutes en parallèle de Homebridge — HomeKit reçoit l'état on/off via le plugin, le relais actionne physiquement la charge.

## Accès local (firmware D8+)

Les firmwares Envoy récents exigent **HTTPS** + **token Bearer** pour tout accès local :

- Le nom local est désormais `envoy.localdomain` (auparavant `envoy.local`).
- Un token JWT longue durée doit être passé dans l'en-tête `Authorization`.
- L'Envoy utilise un certificat auto-signé (le plugin désactive la vérification stricte TLS pour les connexions locales).

### Obtenir votre token local

Générez un token longue durée depuis votre compte Enphase :

[https://entrez.enphaseenergy.com](https://entrez.enphaseenergy.com)

## Bonjour

Exemple de `config.json` pour Bonjour ([https://envoy.localdomain/production.json](https://envoy.localdomain/production.json)) :

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

## URL personnalisée

Exemple de `config.json` pour URL personnalisée :

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

Le plugin utilise l'**API v4 d'Enphase** avec OAuth 2.0. Plans et limites : [https://developer-v4.enphase.com/plans](https://developer-v4.enphase.com/plans).  
Le plan Watt permet 10 000 requêtes/mois ; un rafraîchissement toutes les 5 minutes reste dans le budget (12 × 24 × 31 = 8928).

### Étape 1 — Créer l'application

Créez une application sur [https://developer-v4.enphase.com](https://developer-v4.enphase.com). La page de l'application affiche :

- **API Key**
- **Client ID**
- **Client Secret**
- **Authorization URL**, de la forme :  
  `https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=VOTRE_CLIENT_ID`

Vous aurez également besoin de votre **System ID** (l'identifiant numérique de votre système Enlighten, anciennement *site_id*).

### Étape 2 — Obtenir un code d'autorisation

> ⚠️ L'Authorization URL affichée dans le portail développeur est **incomplète** — il manque le paramètre `redirect_uri`. Si vous l'ouvrez telle quelle, vous obtenez :  
> `OAuth Error: error="invalid_request", error_description="A redirect_uri must be supplied."`

Ajoutez `&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri` à votre Authorization URL avant de l'ouvrir :

```
https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=VOTRE_CLIENT_ID&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri
```

Ouvrez cette URL dans un navigateur. Connectez-vous à Enlighten et approuvez l'application. Vous êtes redirigé vers une page qui affiche un **code d'autorisation** court, à usage unique (p. ex. `2TJk7M`). Le code est valable seulement quelques minutes — utilisez-le immédiatement.

La valeur de `redirect_uri` doit correspondre **exactement** à celle utilisée à l'étape 3 ci-dessous (même chaîne, même casse).

### Étape 3 — Échanger le code contre un refresh_token

Le refresh token n'est **pas** affiché dans le portail développeur — vous devez le générer une fois avec le code de l'étape 2.

Soit avec curl :

```bash
curl -X POST \
  -u "CLIENT_ID:CLIENT_SECRET" \
  "https://api.enphaseenergy.com/oauth/token?grant_type=authorization_code&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri&code=AUTH_CODE"
```

soit avec le script utilitaire [`examples/get_refresh_token.py`](examples/get_refresh_token.py) : renseignez `CLIENT_ID` et `CLIENT_SECRET` une fois pour toutes, puis passez le code d'autorisation en argument :

```bash
python3 examples/get_refresh_token.py 2TJk7M
```

La réponse JSON ressemble à :

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

- `access_token` → valable 1 jour. Utilisé comme `Authorization: Bearer …` à chaque appel API.
- `refresh_token` → valable ~1 mois. **C'est cette valeur à copier dans `config.json`.** Le plugin l'utilise pour renouveler automatiquement l'access token. À son expiration (~1 mois), refaites les étapes 2-3.

### Étape 4 — config.json pour l'API

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

## Bonus : interroger l'Envoy avec curl

Vous pouvez demander la puissance courante avec cette ligne (remplacez `TOKEN`) :

```bash
curl -sk -H "Authorization: Bearer TOKEN" "https://envoy.localdomain/production.json" | python3 -c "import sys, json; print(json.load(sys.stdin)['production'][1]['wNow'])"
```

Résultat :

```bash
5788.47
```

## Bonus : scripts Python et Piface2

Pour mon usage personnel, j'exécute ces scripts toutes les minutes pour activer mon chauffe-eau via une carte Piface2, en fonction de la production et de la consommation courantes.

#### Installer pifacedigitalio
Merci à @rfennel qui a [partagé sa procédure](https://github.com/piface/pifacedigitalio/issues/39#issuecomment-633291166) sous Buster :

1. Installer PIP (PIP3 pour Python3)
   `sudo apt-get install python3-pip`
2. Installer les bibliothèques
   `sudo pip3 install pifacedigitalio`
   `sudo pip3 install pifacecommon`
3. Activer l'accès SPI aux GPIO (sans cela, le script renvoie une erreur)
   `sudo sed -i 's/#dtparam=spi=on/dtparam=spi=on/' /boot/config.txt`
4. Redémarrer
   `sudo reboot`

Les scripts prêts à l'emploi se trouvent dans le dossier [`examples/`](examples/). Éditez les constantes en tête de chaque fichier, puis lancez avec `python3 <script>.py`. `examples/refresh_token.txt` est gitignoré — gardez-le privé.

### [`examples/check_power_local.py`](examples/check_power_local.py)

Accès local à l'Envoy (HTTPS + token Bearer). Lit production et consommation depuis `/ivp/meters/readings` et pilote un ou deux relais Piface2.

**Options CLI**

- `--mode production --value <W>`  
  Relais ON quand la production totale ≥ `<W>`, OFF sinon.
- `--mode consumption --value <W>`  
  Relais ON quand la maison exporte plus de `<W>` W vers le réseau ; OFF dès que la maison importe (hystérésis pour éviter les oscillations).
- `--relay {0,1} [{0,1} ...]`  
  Index(es) du/des relais Piface à piloter. Défaut : `0`. `--relay 0 1` actionne les deux relais en miroir.

### [`examples/check_power_api.py`](examples/check_power_api.py)

Accès à l'API Cloud v4 — **autonome** :

- Au premier lancement, affiche l'Authorization URL d'Enphase et demande le code d'autorisation à usage unique renvoyé par la redirection navigateur.
- Échange ce code contre un `refresh_token`, sauvé à côté du script dans `refresh_token.txt` (permissions 600).
- Aux lancements suivants, réutilise le `refresh_token` stocké et renouvelle automatiquement l'access token (durée 24 h).
- Si le `refresh_token` est rejeté (expiré ~1 mois plus tard), le script redemande un code d'autorisation et met à jour le fichier.

> Note cron : le prompt interactif exige un TTY, assurez-vous que `refresh_token.txt` existe déjà avant de planifier le script.

### [`examples/get_refresh_token.py`](examples/get_refresh_token.py)

Utilitaire autonome optionnel pour le même échange OAuth. Pratique si vous voulez uniquement un `refresh_token` à coller dans le `config.json` de Homebridge (sans la logique Piface).

**Usage**

```bash
python3 examples/get_refresh_token.py <CODE_AUTORISATION>
```

Affiche le `refresh_token` sur stdout, prêt à copier.

#### Exemple cron
Lancez l'éditeur cron
```shell
crontab -e
```
Exécution du script local toutes les minutes (choisissez l'un des deux modes ; `--relay` vaut 0 par défaut, ou passez `--relay 0 1` pour piloter les deux) :
```
# m h  dom mon dow   command
# Mode production — relais 0 ON quand production ≥ 6000 W
* * * * * python3 /home/pi/check_power_local.py --mode production --value 6000

# Mode consommation — relais 1 ON quand export > 4500 W vers le réseau
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 1

# Les deux relais en miroir sur l'export
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 0 1
```
