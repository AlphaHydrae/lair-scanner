'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const expand = require('expand-tilde');
const fs = require('fs-extra');
const inflection = require('inflection');
const log4js = require('log4js');
const path = require('path');
const yaml = require('js-yaml');

var defaults = {
  file: '~/.lair/config.yml',
  ignores: [ '**/.DS_Store', '**/@eaDir' ],
  extensions: [ 'avi', 'divx', 'idx', 'jpg', 'mkv', 'mp4', 'nfo', 'ogm', 'rm', 'srt', 'ssa', 'sub', 'yml' ],
  logLevel: 'INFO'
};

var optionNames = [ 'logLevel', 'scannerId' ],
    optionNamesWithFile = optionNames.concat([ 'file' ]),
    serverOptionNames = [ 'url', 'token' ];

module.exports = function(options) {

  var config = pick(options, optionNamesWithFile);
  config.server = {};

  if (_.isObject(options.server)) {
    _.each(serverOptionNames, function(name) {
      if (!_.has(config.server, name) && options.server[name]) {
        config.server[name] = options.server[name];
      }
    });
  } else {
    config.server = {};
  }

  _.each(optionNamesWithFile, function(name) {
    var envName = 'LAIR_SCANNER_' + inflection.underscore(name).toUpperCase();
    if (!_.has(config[name]) && process.env[envName]) {
      config[name] = process.env[envName];
    }
  });

  _.each(serverOptionNames, function(name) {
    var envName = 'LAIR_SCANNER_SERVER_' + inflection.underscore(name).toUpperCase();
    if (!_.has(config.server[name]) && process.env[envName]) {
      config.server[name] = process.env[envName];
    }
  });

  var configFile = path.resolve(expand(config.file || defaults.file));
  config.file = configFile;
  config.fileLoaded = false;

  if (fs.existsSync(configFile)) {

    try {
      var contents = yaml.safeLoad(fs.readFileSync(configFile, { encoding: 'utf-8' }));
      _.each(optionNames, function(name) {
        if (!_.has(config, name) && _.has(contents, name)) {
          config[name] = contents[name];
        }
      });

      if (_.isObject(contents.server)) {
        _.each(serverOptionNames, function(name) {
          if (!_.has(config.server, name) && _.has(contents.server, name)) {
            config.server[name] = contents.server[name];
          }
        });
      }

      config.fileLoaded = true;
    } catch (e) {
      config.fileError = e;
    }
  }

  _.defaults(config, defaults);

  config.root = path.resolve(path.join(__dirname, '..'));
  config.logLevel = config.logLevel.toUpperCase();

  let lastLogLevel;
  config.logger = function(name) {
    if (!_.isString(name)) {
      throw new Error('Logger name is required');
    }

    if (config.logLevel != lastLogLevel) {
      lastLogLevel = config.logLevel;

      log4js.configure({
        appenders: {
          out: {
            type: 'stdout',
            layout: {
              type: _.includes([ 'ALL', 'TRACE' ], config.logLevel.toUpperCase()) ? 'colored' : 'messagePassThrough'
            }
          }
        },
        categories: {
          default: {
            appenders: [ 'out' ],
            level: config.logLevel
          }
        }
      });
    }

    const logger = log4js.getLogger(name);

    return logger;
  };

  config.save = function(file) {

    var configFile = file || config.file,
        contents = yaml.safeDump(_.pick(config, optionNames.concat([ 'server' ])));

    return fs.mkdirsAsync(path.dirname(configFile)).then(function() {
      return fs.writeFileAsync(configFile, contents);
    });
  };

  return BPromise.resolve(config);
};

function pick(source, properties) {
  return _.pick.apply(_, [ source ].concat(properties));
}
