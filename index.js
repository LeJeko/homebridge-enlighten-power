"use strict";

const http = require("http");
const https = require("https");

let Service, Characteristic;

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-enlighten-power", "enlighten-power", AirQualityAccessory);
};

class AirQualityAccessory {
  constructor(log, config) {
    if (!log || !config) {
      return;
    }
    this.log = log;
    this.log("Initialising...");

    this.name = config.name;
    this.connection = config.connection || "bonjour";
    this.co2Threshold = config.power_threshold;
    this.co2CurrentLevel = 0;
    this.co2Detected = 0;

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
      this.updateInterval = config.update_interval || 1;
      const productionType = config.type || "eim";
      this.type = (productionType === "eim") ? 1 : 0;
      if (!this.token) {
        this.log.error("Missing 'token' in config: a Bearer token is required for local HTTPS access to the Envoy.");
      }
    }

    this.service = new Service.CarbonDioxideSensor(this.name);
    this.service.getCharacteristic(Characteristic.CarbonDioxideLevel)
      .onGet(() => this.co2CurrentLevel);
    this.service.getCharacteristic(Characteristic.CarbonDioxideDetected)
      .onGet(() => this.co2Detected);

    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, "Homebridge")
      .setCharacteristic(Characteristic.Model, "Enlighten")
      .setCharacteristic(Characteristic.SerialNumber, "0000030");

    this.poll();
    setInterval(() => this.poll(), this.updateInterval * 60000);
  }

  async poll() {
    try {
      const power = await this.fetchCurrentPower();
      this.co2CurrentLevel = (power >= 0) ? power : 0;
      this.co2Detected = (this.co2CurrentLevel >= this.co2Threshold) ? 1 : 0;
      this.log("Enlighten (%s): Current Power = %s W", this.connection, this.co2CurrentLevel);
      this.service.updateCharacteristic(Characteristic.CarbonDioxideLevel, this.co2CurrentLevel);
      this.service.updateCharacteristic(Characteristic.CarbonDioxideDetected, this.co2Detected);
    } catch (err) {
      this.log("Error getting current power: %s", err.message);
    }
  }

  async fetchCurrentPower() {
    let accessToken = null;
    if (this.connection === "api") {
      accessToken = await this.refreshAccessToken();
    }
    const json = await this.requestJson(accessToken);
    if (this.connection === "api") {
      return Math.round(parseFloat(json.current_power));
    }
    return Math.round(parseFloat(json.production[this.type].wNow));
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

  requestJson(accessToken) {
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
    if (this.token && (this.connection === "bonjour" || this.connection === "url")) {
      options.headers.Authorization = `Bearer ${this.token}`;
    }
    if (this.connection === "api" && accessToken) {
      options.headers.Authorization = `Bearer ${accessToken}`;
    }

    return new Promise((resolve, reject) => {
      const req = protocol.request(options, (resp) => {
        this.log.debug("GET response received (%s)", resp.statusCode);
        let data = "";
        resp.on("data", (chunk) => { data += chunk; });
        resp.on("end", () => {
          if (resp.statusCode !== 200) {
            if (this.connection === "api" && resp.statusCode === 401) {
              // Cached access token rejected before its expiry — force a refresh next poll
              this.access_token = null;
              this.access_token_expires_at = 0;
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
