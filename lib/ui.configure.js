const _ = require('lodash');
const apiFactory = require('./api');
const configLoader = require('./config');
const errors = require('./errors');
const fs = require('fs-extra');
const log = require('./log');
const p = require('bluebird');
const path = require('path');
const ui = require('./ui');
const validator = require('validator');

module.exports = function(config, options) {
  options = _.extend({}, options);

  var configModified = false;

  return p.resolve()
    .then(checkConfigFile)
    .then(enrichConfigWithOptions)
    .then(askForUrl)
    .then(askForToken)
    .then(checkConnection)
    .then(saveConfig)
    .then(function() {
      return config;
    });

  function checkConfigFile() {
    if (!fs.existsSync(config.file)) {
      if (!options.save) {
        var setupMessage = "This is your first time using the Lair scanner.";
        setupMessage += "\nThe configuration needs to be set up before it can be used.";
        log.message(setupMessage);
        log.newLine();
      }
    }
  }

  function enrichConfigWithOptions() {
    if (_.has(options, 'serverUrl')) {
      config.server.url = options.serverUrl;
    }

    if (_.has(options, 'serverToken')) {
      config.server.token = options.serverToken;
    }
  }

  function askForUrl() {
    if (!config.server.url || options.force && !options.serverUrl) {

      var message = 'Please enter the URL to the Lair media center:',
          askOptions = {
            default: config.server.url,
            validate: function(value) {
              return validator.isURL(value, { require_tld: false, protocols: [ 'http', 'https' ] }) || 'Please enter a valid URL:';
            }
          };

      return ui.askFor(message, askOptions).then(function(answer) {
        config.server.url = answer;
        configModified = true;
        return;
      });
    }
  }

  function askForToken() {
    if (!config.server.token || options.force && !options.serverToken) {

      var message = 'Please enter an authentication token from the Lair media center (you can generate one in your Profile page):',
          askOptions = {
            default: config.server.token,
            hideDefault: true
          };

      return ui.askFor(message, askOptions).then(function(answer) {
        config.server.token = answer;
        configModified = true;
        return;
      });
    }
  }

  function checkConnection() {

    var api = apiFactory(config);
    log.start('Connecting to the Lair media center');

    return api({ url: '/' }).then(function(res) {
      if (res.statusCode == 200) {
        log.stop('success', 'lair ' + res.body.version + ', API v' + res.body.apiVersion + ', ' + config.server.url);
        return res.body;
      } else if (res.statusCode == 401) {
        log.stop('warn', 'not logged in');
        return askForNewToken();
      } else {
        log.stop('error', 'failed');
        throw errors.unexpectedServerResponse('Could not connect to the Lair media center', res, { expected: '200 or 401' });
      }
    }).catch(log.stopErrorHandler());
  }

  function askForNewToken(query) {

    var newTokenQuery = query;

    if (!newTokenQuery) {
      newTokenQuery = 'Your authentication token is either invalid or has expired.';
      newTokenQuery += '\nPlease enter a new one (you can generate one in your Profile page):';
    }

    return ui.askFor(newTokenQuery).then(function(answer) {
      if (!answer || !answer.trim().length) {
        return askForNewToken('Please enter a valid authentication token:');
      }

      config.server.token = answer;
      configModified = true;

      return checkConnection();
    });
  }

  function saveConfig() {
    if (options.save || configModified) {
      log.start('Saving configuration');
      return config.save().then(function() {
        log.stop('success', 'saved to ' + config.file);
        return config;
      }, log.stopErrorHandler());
    }
  }
};
