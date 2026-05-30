
<p align="center">
  <a href="https://github.com/homebridge/homebridge"><img src="https://raw.githubusercontent.com/homebridge/branding/master/logos/homebridge-color-round-stylized.png" height="140"></a>
</p>

<span align="center">

# homebridge-enlighten-power

[![npm](https://img.shields.io/npm/v/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![npm](https://img.shields.io/npm/dt/homebridge-enlighten-power.svg)](https://www.npmjs.com/package/homebridge-enlighten-power) [![Homebridge v2 Ready](https://img.shields.io/badge/Homebridge-v2%20Ready-purple)](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0)

</span>

> 🌐 [English version](README.md) · **Français**

> ⚠️ **Mise à niveau depuis la 2.x ?** La version 3.0.0 est un changement non rétro-compatible — le plugin est désormais une **platform dynamique**. Voir le [guide de migration](#migration-depuis-la-2x) ci-dessous.

## Description

Ce plugin Homebridge expose votre système solaire Enphase Envoy dans HomeKit sous forme d'un ou plusieurs capteurs. Chaque accessoire surveille soit la **production** (énergie générée), soit la **consommation** (échange net avec le réseau), et bascule dans son état déclenché quand la valeur franchit un seuil configurable — pratique comme source d'événement pour les automatisations HomeKit.

Tous les accessoires partagent une seule connexion Envoy et un seul token d'authentification. Trois méthodes de connexion sont supportées. Le dépôt fournit aussi trois [scripts Python](#scripts-python-compagnons) autonomes pour piloter un relais Piface2 depuis un Raspberry Pi — **complètement indépendants de Homebridge**.

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
| **3** | [**API Cloud v4** (OAuth 2.0)](#méthode-3--api-cloud-v4) | Fonctionne sans accès LAN à l'Envoy. Production + consommation. | 1 000 req/mois ; intervalle 60 min recommandé ; mise en place OAuth ponctuelle. |

> Dans l'interface Homebridge, le menu *Connection* gère la méthode 3 face aux méthodes locales, et le menu *Authentication method* gère la méthode 1 face à la méthode 2. Si vous éditez `config.json` à la main, vous pouvez omettre `auth_method` — le plugin déduit la méthode (le `token` l'emporte si les deux groupes sont remplis).

---

### Méthode 1 — Local + token statique

Accès HTTPS local avec un JWT longue durée que vous générez vous-même, **une fois**.

#### 1. Générer le token

1. Ouvrir <https://entrez.enphaseenergy.com> et se connecter.
2. Générer un token pour votre Envoy (l'outil demande le numéro de série).
3. Copier le JWT dans `config.json` (voir ci-dessous). Il expire au bout d'environ 1 an.

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

URL personnalisée (accès par IP) :

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

> **À propos de l'API locale.** `envoy.localdomain` est le nom mDNS utilisé par les firmwares D8+. L'Envoy fournit un certificat auto-signé — le plugin désactive la vérification TLS stricte uniquement pour les connexions locales. Au démarrage, le plugin appelle `/ivp/meters` pour associer le `eid` de chaque compteur à son `measurementType` (`"production"` ou `"net-consumption"`). À chaque cycle, il appelle `/ivp/meters/readings` et retrouve les entrées par `eid` — pas par position dans le tableau.

---

### Méthode 2 — Local + auto-refresh

Même accès local qu'à la méthode 1, mais le plugin **obtient et renouvelle le JWT pour vous**, automatiquement.

```json
{
  "platforms": [
    {
      "platform": "EnlightenPower",
      "name": "Enlighten Power",
      "connection": "bonjour",
      "auth_method": "auto_refresh",
      "enlighten_user": "vous@example.com",
      "enlighten_pass": "MOT_DE_PASSE_ENLIGHTEN",
      "envoy_serial": "1234XXXXXXXX",
      "update_interval": 1,
      "accessories": [
        { "name": "> 6000 W production", "measurement": "production", "power_threshold": 6000 }
      ]
    }
  ]
}
```

Ce qui se passe à l'exécution :

1. Au démarrage, le plugin se connecte à `enlighten.enphaseenergy.com` avec vos identifiants.
2. Il demande à `entrez.enphaseenergy.com` un JWT frais lié au numéro de série de votre Envoy.
3. Le JWT est mis en cache en mémoire et réutilisé à chaque poll.
4. Quand le JWT arrive à moins de 7 jours d'expiration — ou après un `401` de l'Envoy — un nouveau JWT est récupéré automatiquement.

---

### Méthode 3 — API Cloud v4

Accès OAuth 2.0 à l'API développeur Enphase. À utiliser quand Homebridge ne peut pas joindre l'Envoy sur le réseau local. **Seule la mesure `production` est disponible** (l'API Cloud n'expose pas la consommation nette instantanée).

Plans : <https://developer-v4.enphase.com/plans>. Le quota du plan gratuit a été **réduit de 10 000 à 1 000 requêtes/mois** par Enphase. Réglez `update_interval` à **60** (1 requête/heure = 720/mois) pour rester dans le budget. Le plugin effectue un premier poll au démarrage, puis aligne les suivants sur les limites de l'horloge — avec `update_interval: 60` les données sont rafraîchies à l'heure pile (10:00, 11:00, …). Le plugin utilise l'endpoint `latest_telemetry` qui retourne production et consommation en un seul appel, donc la mesure `consumption` est aussi disponible avec l'API Cloud.

#### Étape 1 — Créer l'application

Sur <https://developer-v4.enphase.com>, créez une application. La page affiche :

- **API Key** · **Client ID** · **Client Secret**
- **Authorization URL** de la forme `https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=VOTRE_CLIENT_ID`

Vous avez aussi besoin de votre **System ID** (identifiant numérique du système Enlighten, anciennement *site_id*).

#### Étape 2 — Obtenir un code d'autorisation

> ⚠️ L'Authorization URL du portail est **incomplète** — il manque `redirect_uri`. Ajoutez `&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri`, sinon vous obtenez `OAuth Error: A redirect_uri must be supplied.`

URL complète :

```text
https://api.enphaseenergy.com/oauth/authorize?response_type=code&client_id=VOTRE_CLIENT_ID&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri
```

Ouvrez-la, connectez-vous à Enlighten, approuvez. La page de redirection affiche un code court à usage unique (p. ex. `2TJk7M`), valable seulement quelques minutes.

#### Étape 3 — Échanger le code contre un refresh_token

```bash
curl -X POST \
  -u "CLIENT_ID:CLIENT_SECRET" \
  "https://api.enphaseenergy.com/oauth/token?grant_type=authorization_code&redirect_uri=https://api.enphaseenergy.com/oauth/redirect_uri&code=AUTH_CODE"
```

Ou avec [`examples/get_refresh_token.py`](examples/get_refresh_token.py) :

```bash
python3 examples/get_refresh_token.py 2TJk7M
```

Copiez le `refresh_token` de la réponse — valable ~1 mois. Le plugin renouvelle l'access token 24h automatiquement. À l'expiration du refresh token, refaites les étapes 2-3.

#### Étape 4 — config.json

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
      "update_interval": 60,
      "accessories": [
        { "name": "> 6000 W production", "measurement": "production", "power_threshold": 6000 }
      ]
    }
  ]
}
```

---

### Accessoires

Chaque entrée du tableau `accessories` est un capteur HomeKit indépendant. Tous partagent la connexion et l'authentification de la plateforme.

| Champ | Requis | Défaut | Description |
| --- | --- | --- | --- |
| `name` | ✅ | — | Nom affiché dans HomeKit. Doit être unique. |
| `measurement` | | `production` | `production` (énergie solaire générée) ou `consumption` (échange net réseau). Disponible pour toutes les connexions. |
| `power_threshold` | | `1000` | Seuil de déclenchement en W. Voir ci-dessous. |
| `accessory_type` | | `co2sensor` | Type de capteur HomeKit — voir [Type d'accessoire HomeKit](#type-daccessoire-homekit). |

**Mode production** — se déclenche quand `production ≥ seuil` ; se réinitialise en dessous.

**Mode consommation** — reproduit l'hystérésis des scripts Piface :

- `detected → 1` quand `net ≤ −seuil` (la maison exporte plus que le seuil vers le réseau).
- `detected → 0` quand `net ≥ 0` (la maison importe depuis le réseau).
- Le niveau affiché est la valeur absolue de l'échange réseau en W.

> Si un accessoire `consumption` est configuré avec `connection: api`, le plugin logge un avertissement et retombe sur `production`.

---

### Type d'accessoire HomeKit

| Valeur | Service HomeKit | Comportement |
| --- | --- | --- |
| `co2sensor` (défaut) | Capteur CO2 | Puissance en ppm + drapeau Détecté au-dessus du seuil. |
| `motion` | Détecteur de mouvement | Mouvement détecté au-dessus du seuil. |
| `occupancy` | Détecteur de présence | Occupé au-dessus du seuil. |
| `contact` | Capteur de contact | Ouvert au-dessus du seuil. |
| `lightsensor` | Capteur de luminosité | Puissance en lux (plafonnée à 100 000). |

---

### Test rapide depuis un shell

Envoy local — lectures des compteurs :

```bash
curl -sk -H "Authorization: Bearer TOKEN" "https://envoy.localdomain/ivp/meters/readings" \
  | python3 -c "import sys, json; d=json.load(sys.stdin); print('prod', d[0]['activePower'], 'W  net', d[1]['activePower'], 'W')"
```

---

## Migration depuis la 2.x

> ⚠️ **Désinstallation propre obligatoire.** Le type du plugin ayant changé d'`accessory` à `platform`, Homebridge génère les UUIDs différemment et les données de cache de l'ancien accessoire entrent en conflit. **Ne faites pas une simple mise à jour** — suivez les étapes ci-dessous.

### Étapes de migration — via l'interface Homebridge

1. **Onglet Plugins → Homebridge Enlighten Power → Désinstaller.** Confirmer. Cela arrête le child bridge et supprime le plugin.
2. **Onglet Accessories** — si l'ancien accessoire est encore listé, cliquer sur l'icône ⚙️ → *Supprimer l'accessoire*. Si l'onglet est vide ou que l'accessoire a disparu, passer à l'étape suivante.
3. **Settings → Config** (éditeur JSON) — vérifier que le tableau `"accessories"` ne contient plus aucun bloc `"accessory": "enlighten-power"`. Sauvegarder.
4. **Settings → Homebridge Settings → Redémarrer Homebridge** une fois pour vider le cache des accessoires.
5. **Onglet Plugins → rechercher "Homebridge Enlighten Power" → Installer**, ou depuis un terminal : `npm install -g homebridge-enlighten-power`.
6. **Configurer** le plugin via l'interface graphique des réglages ou en éditant `config.json` comme indiqué ci-dessous.
7. **Supprimer de HomeKit** si l'accessoire apparaît toujours comme non répondant dans l'app Maison : appui long → *Supprimer l'accessoire*.

### Étapes de migration — via terminal (avancé)

```bash
# 1. Désinstaller
npm uninstall -g homebridge-enlighten-power

# 2. Supprimer le cache des accessoires
rm /homebridge/accessories/cachedAccessories
rm /homebridge/accessories/cachedAccessories.*.json 2>/dev/null

# 3. Réinstaller
npm install -g homebridge-enlighten-power   # version stable

# 4. Éditer config.json, puis redémarrer Homebridge
```

### Changements de config

Le plugin est désormais une **platform** (`"platform": "EnlightenPower"`) et non plus un accessoire (`"accessory": "enlighten-power"`). La config doit être déplacée de la section `accessories` vers la section `platforms`.

**Avant** (`config.json` — v2.x) :

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

**Après** (`config.json` — v3.x) :

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

## Scripts Python compagnons

Le dépôt fournit également trois scripts Python autonomes dans [`examples/`](examples/). Ils sont **indépendants de Homebridge** — pour les utilisateurs qui veulent piloter directement un **relais Piface2** depuis un Raspberry Pi à partir des données de l'Envoy.

### Installer pifacedigitalio

Merci à @rfennel qui a [partagé la procédure](https://github.com/piface/pifacedigitalio/issues/39#issuecomment-633291166) sous Buster :

```bash
sudo apt-get install python3-pip
sudo pip3 install pifacedigitalio pifacecommon
sudo sed -i 's/#dtparam=spi=on/dtparam=spi=on/' /boot/config.txt
sudo reboot
```

### [`examples/check_power_local.py`](examples/check_power_local.py)

Accès local à l'Envoy (HTTPS + token Bearer). Lit production et consommation depuis `/ivp/meters/readings` et pilote un ou deux relais Piface2.

- `--mode production --value <W>` — relais ON quand la production ≥ valeur, OFF sinon.
- `--mode consumption --value <W>` — relais ON quand la maison exporte plus que la valeur ; OFF dès qu'elle importe (hystérésis).
- `--relay {0,1} [{0,1} ...]` — index(es) du/des relais. Défaut : `0`. `--relay 0 1` actionne les deux.

### [`examples/check_power_api.py`](examples/check_power_api.py)

API Cloud v4 — autonome. Gère le flux OAuth complet, stocke le refresh token dans `refresh_token.txt` et renouvelle automatiquement l'access token.

### [`examples/get_refresh_token.py`](examples/get_refresh_token.py)

Utilitaire autonome pour l'échange OAuth.

```bash
python3 examples/get_refresh_token.py <CODE_AUTORISATION>
```

### Exemple cron

```cron
# Mode production — relais 0 ON quand production ≥ 6000 W
* * * * * python3 /home/pi/check_power_local.py --mode production --value 6000

# Mode consommation — relais 1 ON quand export > 4500 W vers le réseau
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 1

# Les deux relais en miroir sur l'export
* * * * * python3 /home/pi/check_power_local.py --mode consumption --value 4500 --relay 0 1
```
