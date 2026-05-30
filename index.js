"use strict";

const http = require("http");
const https = require("https");
const querystring = require("querystring");

let Service, Characteristic, UUIDGen;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  homebridge.registerPlatform("homebridge-enlighten-power", "EnlightenPower", EnlightenPowerPlatform);
};

const ACCESSORY_TYPES = ["co2sensor", "motion", "occupancy", "contact", "lightsensor"];

class EnlightenPowerPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.cachedAccessories = [];
    this.accessories = [];

    this.connection = config.connection || "bonjour";
    this.updateInterval = config.update_interval || (this.connection === "api" ? 5 : 1);

    if (this.connection === "api") {
      this.api_key = config.api_key;
      this.client_id = config.client_id;
      this.client_secret = config.client_secret;
      this.system_id = config.system_id;
      this.refresh_token = config.refresh_token;
      this.access_token = null;
      this.access_token_expires_at = 0;
      if (!this.api_key || !this.client_id || !this.client_secret || !this.system_id || !this.refresh_token) {
        this.log.error("Credentials manquants : api_key, client_id, client_secret, system_id et refresh_token sont requis.");
      }
    } else {
      if (this.connection === "bonjour") {
        this.baseUrl = "https://envoy.localdomain";
      } else {
        // Accept full URL (e.g. https://ip/production.json) or bare base URL
        try {
          this.baseUrl = new URL(config.url || "").origin;
        } catch {
          this.baseUrl = config.url || "";
        }
      }
      this.token = config.token;
      this.enlighten_user = config.enlighten_user;
      this.enlighten_pass = config.enlighten_pass;
      this.envoy_serial = config.envoy_serial;
      this.cachedLocalToken = null;
      this.eidMap = null;

      const hasStaticToken = !!this.token;
      const hasAutoRefreshCreds = !!(this.enlighten_user && this.enlighten_pass && this.envoy_serial);
      if (config.auth_method === "auto_refresh") {
        this.useAutoRefresh = true;
      } else if (config.auth_method === "static_token") {
        this.useAutoRefresh = false;
      } else {
        this.useAutoRefresh = !hasStaticToken && hasAutoRefreshCreds;
      }

      if (this.useAutoRefresh && !hasAutoRefreshCreds) {
        this.log.error("auto_refresh requiert 'enlighten_user', 'enlighten_pass' et 'envoy_serial'.");
      } else if (!this.useAutoRefresh && !hasStaticToken) {
        this.log.error("static_token requiert un champ 'token'. Sinon, utilisez auth_method=auto_refresh.");
      }
    }

    api.on("didFinishLaunching", () => this.syncAccessories());
  }

  configureAccessory(accessory) {
    this.cachedAccessories.push(accessory);
  }

  syncAccessories() {
    let desiredList = this.config.accessories;

    if (!Array.isArray(desiredList)) {
      this.log.error(
        "Aucun accessoire configuré. Ajoutez un tableau 'accessories' dans la config platform. " +
        "Voir README pour la procédure de migration depuis la v2."
      );
      return;
    }

    const activeUUIDs = new Set();

    for (const accConfig of desiredList) {
      if (!accConfig.name) {
        this.log.warn("Un accessoire sans champ 'name' a été ignoré.");
        continue;
      }
      const uuid = UUIDGen.generate("enlighten-power:" + accConfig.name);
      activeUUIDs.add(uuid);

      let platformAcc = this.cachedAccessories.find(a => a.UUID === uuid);
      if (!platformAcc) {
        platformAcc = new this.api.platformAccessory(accConfig.name, uuid);
        this.api.registerPlatformAccessories("homebridge-enlighten-power", "EnlightenPower", [platformAcc]);
      }

      this.accessories.push(new EnlightenPowerAccessory(this.log, accConfig, platformAcc, this.connection));
    }

    const toRemove = this.cachedAccessories.filter(a => !activeUUIDs.has(a.UUID));
    if (toRemove.length > 0) {
      this.api.unregisterPlatformAccessories("homebridge-enlighten-power", "EnlightenPower", toRemove);
      this.log("%s accessoire(s) supprimé(s) de HomeKit.", toRemove.length);
    }

    this.pollAll();
    const scheduleNext = () => {
      setTimeout(() => { this.pollAll(); scheduleNext(); }, this.msUntilNextSlot());
    };
    scheduleNext();
  }

  msUntilNextSlot() {
    const now = new Date();
    const intervalMs = this.updateInterval * 60000;
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const msIntoSlot = (now - startOfDay) % intervalMs;
    return intervalMs - msIntoSlot;
  }

  async pollAll() {
    try {
      let data;

      if (this.connection === "api") {
        const token = await this.refreshAccessToken();
        const url = `https://api.enphaseenergy.com/api/v4/systems/${this.system_id}/latest_telemetry?key=${this.api_key}`;
        const json = await this.requestJson(url, token);
        const meters = json.devices && json.devices.meters ? json.devices.meters : [];
        const prod = meters.filter(m => m.name === "production").reduce((s, m) => s + (m.power || 0), 0);
        const cons = meters.filter(m => m.name === "consumption").reduce((s, m) => s + (m.power || 0), 0);
        data = {
          production: Math.round(prod),
          consumption: Math.round(cons - prod), // net réseau : négatif = export
        };
      } else {
        const token = await this.ensureLocalToken();

        if (!this.eidMap) {
          const meters = await this.requestJson(this.baseUrl + "/ivp/meters", token);
          const prod = meters.find(m => m.measurementType === "production");
          const cons = meters.find(m => m.measurementType === "net-consumption");
          this.eidMap = {
            productionEid: prod ? prod.eid : null,
            consumptionEid: cons ? cons.eid : null,
          };
          if (!this.eidMap.consumptionEid) {
            this.log.warn("Aucun compteur 'net-consumption' trouvé — les accessoires 'consumption' afficheront 0.");
          }
        }

        const readings = await this.requestJson(this.baseUrl + "/ivp/meters/readings", token);
        const prodEntry = this.eidMap.productionEid !== null
          ? readings.find(r => r.eid === this.eidMap.productionEid)
          : null;
        const consEntry = this.eidMap.consumptionEid !== null
          ? readings.find(r => r.eid === this.eidMap.consumptionEid)
          : null;
        data = {
          production: prodEntry ? Math.round(parseFloat(prodEntry.activePower)) : 0,
          consumption: consEntry ? Math.round(parseFloat(consEntry.activePower)) : 0,
        };
      }

      for (const acc of this.accessories) {
        acc.update(data);
      }
    } catch (err) {
      this.log.error("Erreur polling: %s", err.message);
      if (err.message && err.message.includes("401")) {
        if (this.connection === "api") {
          this.access_token = null;
          this.access_token_expires_at = 0;
        } else {
          this.cachedLocalToken = null;
          this.eidMap = null;
        }
      }
    }
  }

  // --- Auth helpers ---

  async ensureLocalToken() {
    if (!this.useAutoRefresh) {
      if (!this.token) throw new Error("Missing local Envoy token");
      return this.token;
    }
    if (this.cachedLocalToken && !this.isTokenExpiringSoon(this.cachedLocalToken)) {
      return this.cachedLocalToken;
    }
    if (!this.enlighten_user || !this.enlighten_pass || !this.envoy_serial) {
      throw new Error("Missing local Envoy auth credentials");
    }
    this.log("Connexion à Enlighten pour renouveler le token local...");
    const sessionId = await this.loginToEnlighten();
    const token = await this.fetchTokenFromEntrez(sessionId);
    this.cachedLocalToken = token;
    const exp = this.tokenExpiryMs(token);
    if (exp) {
      const days = Math.round((exp - Date.now()) / 86400000);
      this.log("Token Envoy local renouvelé (expire dans ~%s jours).", days);
    } else {
      this.log("Token Envoy local renouvelé.");
    }
    return token;
  }

  loginToEnlighten() {
    return new Promise((resolve, reject) => {
      const body = querystring.stringify({
        "user[email]": this.enlighten_user,
        "user[password]": this.enlighten_pass,
      });
      const options = {
        hostname: "enlighten.enphaseenergy.com",
        path: "/login/login.json",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "Accept": "application/json",
        },
      };
      const req = https.request(options, (resp) => {
        let data = "";
        resp.on("data", (c) => { data += c; });
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            return reject(new Error(`Enlighten login failed: HTTP ${resp.statusCode} ${resp.statusMessage}`));
          }
          try {
            const json = JSON.parse(data);
            if (!json.session_id) return reject(new Error("Enlighten login response missing session_id"));
            resolve(json.session_id);
          } catch {
            reject(new Error("Enlighten login response is not JSON"));
          }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  fetchTokenFromEntrez(sessionId) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        session_id: sessionId,
        serial_num: this.envoy_serial,
        username: this.enlighten_user,
      });
      const options = {
        hostname: "entrez.enphaseenergy.com",
        path: "/tokens",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Accept": "text/plain",
        },
      };
      const req = https.request(options, (resp) => {
        let data = "";
        resp.on("data", (c) => { data += c; });
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            return reject(new Error(`Entrez token request failed: HTTP ${resp.statusCode} - ${data}`));
          }
          const token = data.trim();
          if (!token) return reject(new Error("Entrez returned an empty token"));
          resolve(token);
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  tokenExpiryMs(token) {
    try {
      const parts = token.split(".");
      if (parts.length < 2) return null;
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
      return payload.exp ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  isTokenExpiringSoon(token) {
    const exp = this.tokenExpiryMs(token);
    if (!exp) return false;
    return exp - Date.now() < 7 * 86400000;
  }

  refreshAccessToken() {
    if (this.access_token && this.access_token_expires_at > Date.now() + 60000) {
      return Promise.resolve(this.access_token);
    }
    if (!this.refresh_token || !this.client_id || !this.client_secret) {
      return Promise.reject(new Error("Missing OAuth credentials"));
    }
    const tokenUrl = new URL("https://api.enphaseenergy.com/oauth/token");
    tokenUrl.searchParams.set("grant_type", "refresh_token");
    tokenUrl.searchParams.set("refresh_token", this.refresh_token);
    const basicAuth = Buffer.from(`${this.client_id}:${this.client_secret}`).toString("base64");
    const options = {
      hostname: tokenUrl.hostname,
      path: tokenUrl.pathname + tokenUrl.search,
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Accept": "application/json",
        "Content-Length": 0,
      },
    };
    return new Promise((resolve, reject) => {
      const req = https.request(options, (resp) => {
        let data = "";
        resp.on("data", (chunk) => { data += chunk; });
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            this.log.error("OAuth token refresh failed: %s - %s", resp.statusCode, data);
            return reject(new Error("Token refresh failed"));
          }
          try {
            const json = JSON.parse(data);
            this.access_token = json.access_token;
            if (json.refresh_token) this.refresh_token = json.refresh_token;
            const expiresIn = parseInt(json.expires_in, 10) || 86400;
            this.access_token_expires_at = Date.now() + expiresIn * 1000;
            this.log("OAuth access token renouvelé (expire dans %s s).", expiresIn);
            resolve(this.access_token);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on("error", (err) => {
        this.log.error("OAuth request error: %s", err.message);
        reject(err);
      });
      req.end();
    });
  }

  requestJson(urlStr, token) {
    const url = new URL(urlStr);
    const protocol = url.protocol === "http:" ? http : https;
    const options = {
      hostname: url.hostname,
      port: url.port || undefined,
      path: url.pathname + url.search,
      method: "GET",
      headers: { "Accept": "application/json" },
    };
    if (url.protocol === "https:" && this.connection !== "api") {
      options.rejectUnauthorized = false;
    }
    if (token) options.headers.Authorization = `Bearer ${token}`;
    return new Promise((resolve, reject) => {
      const req = protocol.request(options, (resp) => {
        let data = "";
        resp.on("data", (chunk) => { data += chunk; });
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            return reject(new Error(`HTTP ${resp.statusCode}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Response is not JSON"));
          }
        });
      });
      req.on("error", reject);
      req.end();
    });
  }
}

class EnlightenPowerAccessory {
  constructor(log, config, platformAccessory, connection) {
    this.log = log;
    this.name = config.name;
    this.threshold = config.power_threshold || 1000;
    this.measurement = (config.measurement || "production").toLowerCase();


    const wantedType = (config.accessory_type || "co2sensor").toLowerCase();
    this.accessoryType = ACCESSORY_TYPES.includes(wantedType) ? wantedType : "co2sensor";
    if (wantedType !== this.accessoryType) {
      this.log.warn("[%s] accessory_type inconnu '%s', repli sur 'co2sensor'.", this.name, wantedType);
    }

    this.currentPower = 0;
    this.detected = 0;

    const infoService = platformAccessory.getService(Service.AccessoryInformation)
      || platformAccessory.addService(Service.AccessoryInformation);
    infoService
      .setCharacteristic(Characteristic.Manufacturer, "Homebridge")
      .setCharacteristic(Characteristic.Model, "Enlighten")
      .setCharacteristic(Characteristic.SerialNumber, "0000030");

    this.service = this.buildService(platformAccessory);
  }

  buildService(acc) {
    let s;
    switch (this.accessoryType) {
      case "motion":
        s = acc.getService(Service.MotionSensor) || acc.addService(Service.MotionSensor, this.name);
        s.getCharacteristic(Characteristic.MotionDetected).onGet(() => this.detected === 1);
        return s;
      case "occupancy":
        s = acc.getService(Service.OccupancySensor) || acc.addService(Service.OccupancySensor, this.name);
        s.getCharacteristic(Characteristic.OccupancyDetected).onGet(() =>
          this.detected === 1
            ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
            : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        return s;
      case "contact":
        s = acc.getService(Service.ContactSensor) || acc.addService(Service.ContactSensor, this.name);
        s.getCharacteristic(Characteristic.ContactSensorState).onGet(() =>
          this.detected === 1
            ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : Characteristic.ContactSensorState.CONTACT_DETECTED);
        return s;
      case "lightsensor":
        s = acc.getService(Service.LightSensor) || acc.addService(Service.LightSensor, this.name);
        s.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
          .setProps({ minValue: 0.0001, maxValue: 100000 })
          .onGet(() => Math.max(0.0001, Math.min(100000, this.currentPower)));
        return s;
      case "co2sensor":
      default:
        s = acc.getService(Service.CarbonDioxideSensor) || acc.addService(Service.CarbonDioxideSensor, this.name);
        s.getCharacteristic(Characteristic.CarbonDioxideLevel).onGet(() => this.currentPower);
        s.getCharacteristic(Characteristic.CarbonDioxideDetected).onGet(() => this.detected);
        return s;
    }
  }

  update(data) {
    if (this.measurement === "consumption") {
      const net = (typeof data.consumption === "number") ? data.consumption : 0;
      // Hysteresis: detected→1 when net ≤ -threshold (surplus exporté), detected→0 quand net ≥ 0 (import)
      if (net <= -this.threshold) {
        this.detected = 1;
      } else if (net >= 0) {
        this.detected = 0;
      }
      // Affiche la valeur absolue du flux réseau (W échangés avec le réseau)
      this.currentPower = Math.abs(net);
      this.log("[%s] Net réseau: %s W → detected=%s", this.name, net, this.detected);
    } else {
      const prod = (typeof data.production === "number") ? Math.max(0, data.production) : 0;
      this.currentPower = prod;
      this.detected = prod >= this.threshold ? 1 : 0;
      this.log("[%s] Production: %s W → detected=%s", this.name, prod, this.detected);
    }
    this.updateCharacteristics();
  }

  updateCharacteristics() {
    switch (this.accessoryType) {
      case "motion":
        this.service.updateCharacteristic(Characteristic.MotionDetected, this.detected === 1);
        break;
      case "occupancy":
        this.service.updateCharacteristic(Characteristic.OccupancyDetected,
          this.detected === 1
            ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
            : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        break;
      case "contact":
        this.service.updateCharacteristic(Characteristic.ContactSensorState,
          this.detected === 1
            ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : Characteristic.ContactSensorState.CONTACT_DETECTED);
        break;
      case "lightsensor":
        this.service.updateCharacteristic(Characteristic.CurrentAmbientLightLevel,
          Math.max(0.0001, Math.min(100000, this.currentPower)));
        break;
      case "co2sensor":
      default:
        this.service.updateCharacteristic(Characteristic.CarbonDioxideLevel, this.currentPower);
        this.service.updateCharacteristic(Characteristic.CarbonDioxideDetected, this.detected);
        break;
    }
  }
}
