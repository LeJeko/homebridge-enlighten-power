"use strict";

const http = require("http");
const https = require("https");
const querystring = require("querystring");

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-enlighten-power", "enlighten-power", AirQualityAccessory);
};

const ACCESSORY_TYPES = ["co2sensor", "motion", "occupancy", "contact", "lightsensor"];

class AirQualityAccessory {
  constructor(log, config) {
    if (!log || !config) {
      return;
    }
    this.log = log;
    this.log("Initialising...");

    this.name = config.name;
    this.connection = config.connection || "bonjour";
    this.threshold = config.power_threshold;
    this.currentPower = 0;
    this.detected = 0;

    const wantedType = (config.accessory_type || "co2sensor").toLowerCase();
    this.accessoryType = ACCESSORY_TYPES.includes(wantedType) ? wantedType : "co2sensor";
    if (wantedType !== this.accessoryType) {
      this.log.warn("Unknown accessory_type '%s', falling back to 'co2sensor'.", wantedType);
    }

    if (this.connection === "api") {
      this.api_key = config.api_key;
      this.client_id = config.client_id;
      this.client_secret = config.client_secret;
      this.system_id = config.system_id;
      this.refresh_token = config.refresh_token;
      this.access_token = null;
      this.access_token_expires_at = 0;
      this.url = `https://api.enphaseenergy.com/api/v4/systems/${this.system_id}/summary?key=${this.api_key}`;
      this.updateInterval = config.update_interval || 5;
      if (!this.api_key || !this.client_id || !this.client_secret || !this.system_id || !this.refresh_token) {
        this.log.error("Missing API v4 credentials in config: api_key, client_id, client_secret, system_id and refresh_token are required.");
      }
    } else {
      this.url = this.connection === "bonjour"
        ? "https://envoy.localdomain/production.json"
        : config.url;
      this.token = config.token;
      this.enlighten_user = config.enlighten_user;
      this.enlighten_pass = config.enlighten_pass;
      this.envoy_serial = config.envoy_serial;
      this.cachedLocalToken = null;
      this.updateInterval = config.update_interval || 1;
      const productionType = config.type || "eim";
      this.type = (productionType === "eim") ? 1 : 0;
      const hasStatic = !!this.token;
      const hasAutoRefresh = !!(this.enlighten_user && this.enlighten_pass && this.envoy_serial);
      if (!hasStatic && !hasAutoRefresh) {
        this.log.error("Missing local Envoy auth: provide either 'token', or 'enlighten_user' + 'enlighten_pass' + 'envoy_serial' for auto-refresh.");
      }
    }

    this.service = this.buildSensorService();
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, "Homebridge")
      .setCharacteristic(Characteristic.Model, "Enlighten")
      .setCharacteristic(Characteristic.SerialNumber, "0000030");

    this.poll();
    setInterval(() => this.poll(), this.updateInterval * 60000);
  }

  buildSensorService() {
    switch (this.accessoryType) {
      case "motion": {
        const s = new Service.MotionSensor(this.name);
        s.getCharacteristic(Characteristic.MotionDetected).onGet(() => this.detected === 1);
        return s;
      }
      case "occupancy": {
        const s = new Service.OccupancySensor(this.name);
        s.getCharacteristic(Characteristic.OccupancyDetected).onGet(() =>
          this.detected === 1
            ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
            : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        return s;
      }
      case "contact": {
        const s = new Service.ContactSensor(this.name);
        // Above threshold → CONTACT_NOT_DETECTED (open); below → CONTACT_DETECTED (closed)
        s.getCharacteristic(Characteristic.ContactSensorState).onGet(() =>
          this.detected === 1
            ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : Characteristic.ContactSensorState.CONTACT_DETECTED);
        return s;
      }
      case "lightsensor": {
        const s = new Service.LightSensor(this.name);
        s.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
          .setProps({ minValue: 0.0001, maxValue: 100000 })
          .onGet(() => Math.max(0.0001, Math.min(100000, this.currentPower)));
        return s;
      }
      case "co2sensor":
      default: {
        const s = new Service.CarbonDioxideSensor(this.name);
        s.getCharacteristic(Characteristic.CarbonDioxideLevel).onGet(() => this.currentPower);
        s.getCharacteristic(Characteristic.CarbonDioxideDetected).onGet(() => this.detected);
        return s;
      }
    }
  }

  updateSensorCharacteristics() {
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

  async poll() {
    try {
      const power = await this.fetchCurrentPower();
      this.currentPower = (power >= 0) ? power : 0;
      this.detected = (this.currentPower >= this.threshold) ? 1 : 0;
      this.log("Enlighten (%s, %s): Current Power = %s W", this.connection, this.accessoryType, this.currentPower);
      this.updateSensorCharacteristics();
    } catch (err) {
      this.log("Error getting current power: %s", err.message);
    }
  }

  async fetchCurrentPower() {
    let token = null;
    if (this.connection === "api") {
      token = await this.refreshAccessToken();
    } else {
      token = await this.ensureLocalToken();
    }
    const json = await this.requestJson(token);
    if (this.connection === "api") {
      return Math.round(parseFloat(json.current_power));
    }
    return Math.round(parseFloat(json.production[this.type].wNow));
  }

  async ensureLocalToken() {
    if (this.token) {
      return this.token;
    }
    if (this.cachedLocalToken && !this.isTokenExpiringSoon(this.cachedLocalToken)) {
      return this.cachedLocalToken;
    }
    if (!this.enlighten_user || !this.enlighten_pass || !this.envoy_serial) {
      throw new Error("Missing local Envoy auth credentials");
    }
    this.log("Logging in to Enlighten to refresh the local Envoy token...");
    const sessionId = await this.loginToEnlighten();
    const token = await this.fetchTokenFromEntrez(sessionId);
    this.cachedLocalToken = token;
    const exp = this.tokenExpiryMs(token);
    if (exp) {
      const days = Math.round((exp - Date.now()) / 86400000);
      this.log("Local Envoy token refreshed (expires in ~%s days).", days);
    } else {
      this.log("Local Envoy token refreshed.");
    }
    return token;
  }

  loginToEnlighten() {
    return new Promise((resolve, reject) => {
      const body = querystring.stringify({
        "user[email]": this.enlighten_user,
        "user[password]": this.enlighten_pass
      });
      const options = {
        hostname: "enlighten.enphaseenergy.com",
        path: "/login/login.json",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          "Accept": "application/json"
        }
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
            if (!json.session_id) {
              return reject(new Error("Enlighten login response missing session_id"));
            }
            resolve(json.session_id);
          } catch (e) {
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
        username: this.enlighten_user
      });
      const options = {
        hostname: "entrez.enphaseenergy.com",
        path: "/tokens",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Accept": "text/plain"
        }
      };
      const req = https.request(options, (resp) => {
        let data = "";
        resp.on("data", (c) => { data += c; });
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            return reject(new Error(`Entrez token request failed: HTTP ${resp.statusCode} ${resp.statusMessage} - ${data}`));
          }
          const token = data.trim();
          if (!token) {
            return reject(new Error("Entrez returned an empty token"));
          }
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
      port: tokenUrl.port,
      path: tokenUrl.pathname + tokenUrl.search,
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Accept": "application/json",
        "Content-Length": 0
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (resp) => {
        let data = "";
        resp.on("data", (chunk) => { data += chunk; });
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            this.log("OAuth token refresh failed: %s %s - %s", resp.statusCode, resp.statusMessage, data);
            return reject(new Error("Token refresh failed"));
          }
          try {
            const json = JSON.parse(data);
            this.access_token = json.access_token;
            if (json.refresh_token) {
              this.refresh_token = json.refresh_token;
            }
            const expiresIn = parseInt(json.expires_in, 10) || 86400;
            this.access_token_expires_at = Date.now() + expiresIn * 1000;
            this.log("OAuth access token refreshed (expires in %s s)", expiresIn);
            resolve(this.access_token);
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on("error", (err) => {
        this.log("OAuth request error: %s", err.message);
        reject(err);
      });
      req.end();
    });
  }

  requestJson(token) {
    const url = new URL(this.url);
    this.log.debug(url);
    const protocol = (url.protocol === "http:") ? http : https;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: "GET",
      headers: { "Accept": "application/json" }
    };

    if (url.protocol === "https:" && (this.connection === "bonjour" || this.connection === "url")) {
      options.rejectUnauthorized = false;
    }
    if (token) {
      options.headers.Authorization = `Bearer ${token}`;
    }

    return new Promise((resolve, reject) => {
      const req = protocol.request(options, (resp) => {
        this.log.debug("GET response received (%s)", resp.statusCode);
        let data = "";
        resp.on("data", (chunk) => { data += chunk; });
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            if (resp.statusCode === 401) {
              if (this.connection === "api") {
                this.access_token = null;
                this.access_token_expires_at = 0;
              } else if (!this.token) {
                this.cachedLocalToken = null;
              }
            }
            return reject(new Error(`HTTP ${resp.statusCode} ${resp.statusMessage || ""}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Response is not JSON"));
          }
        });
      });
      req.on("error", reject);
      req.end();
    });
  }

  getServices() {
    return [this.service, this.informationService];
  }
}
