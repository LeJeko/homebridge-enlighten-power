var request = require("request");
var Service, Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-enlighten-power", "enlighten-power", AirQualityAccessory);
}

function AirQualityAccessory(log, config) {
  this.log = log;
  this.name = config["name"];
  this.connection = config["connection"] || "local"; // local or api
	if (this.connection == "api") {
		this.api_key = config["api_key"];
		this.api_user_id = config["api_user_id"];
		this.site_id = config["site_id"];
		this.url = "https://api.enphaseenergy.com/api/v2/systems/"+this.site_id+"/summary?key="+this.api_key+"&user_id="+this.api_user_id;
		this.updateInterval = config['update_interval'] || "5"; // every 5 min
	}
	else {
		this.url = config["url"] || "http://envoy.local/production.json";
		this.updateInterval = config['update_interval'] || "1"; // every minutes
	}
  this.co2Threshold = config['power_threshold'];
  this.co2CurrentLevel = 999;
  this.co2Detected = 0;
  this.co2LevelUpdated = false;
  
  this.service = new Service.CarbonDioxideSensor(this.name);
    
  this.service
    .getCharacteristic(Characteristic.CarbonDioxideLevel)
    .on('get', this.getCo2Level.bind(this));
  
  this.service
    .getCharacteristic(Characteristic.CarbonDioxideDetected)
    .on('get', this.getCo2Detected.bind(this));
  
  this.informationService = new Service.AccessoryInformation();

  this.informationService
      .setCharacteristic(Characteristic.Manufacturer, "Homebridge")
      .setCharacteristic(Characteristic.Model, "Enlighten")
      .setCharacteristic(Characteristic.SerialNumber, "0000030");

  setInterval(function() {
          this.getCo2Level(function(err, value) {
            if (err) {
              value = err;
            }
            this.service
              .getCharacteristic(Characteristic.CarbonDioxideLevel).updateValue(value);
          }.bind(this));
        }.bind(this), this.updateInterval * 60000);

   this.getCo2Level(function(err, value) {
          this.service
            .setCharacteristic(Characteristic.CarbonDioxideLevel, value);
        }.bind(this));
}

AirQualityAccessory.prototype.setCo2Level = function() {
  this.service
  .setCharacteristic(Characteristic.CarbonDioxideLevel, this.co2CurrentLevel);
}

AirQualityAccessory.prototype.getCo2Level = function(callback) {
  request.get(
  {url: this.url},
  function(err, response, body) {
    if (!err && response.statusCode == 200) {
    var json = JSON.parse(body);
    if (this.connection == "local") {
    	let power = Math.round(parseFloat(json.production[1].wNow));
    	this.co2CurrentLevel = (power >= 0) ? power : 0;
    }
    else {
		this.co2CurrentLevel = Math.round(parseFloat(json.current_power));
    }
    this.co2LevelUpdated = true;
    this.log('Enlighten (%s): Current Power = %s W', this.connection, this.co2CurrentLevel);
    this.setCo2Level();
    this.setCo2Detected();
    }
    else {
      this.log("Error getting current power (status code %s): %s", response.statusCode, err);
    }
  }.bind(this));
  callback(null, this.co2CurrentLevel);
}

AirQualityAccessory.prototype.setCo2Detected = function() {
  if (this.co2CurrentLevel >= this.co2Threshold){
    this.co2Detected = 1;
  }
  else{
    this.co2Detected = 0;
  }
  this.service
  .setCharacteristic(Characteristic.CarbonDioxideDetected, this.co2Detected);
}

AirQualityAccessory.prototype.getCo2Detected = function(callback) {
    this.log('Current Power =', this.co2CurrentLevel, 'W');
    callback(null, this.co2Detected);
}

AirQualityAccessory.prototype.getServices = function() {
  return [this.service, this.informationService];
}
