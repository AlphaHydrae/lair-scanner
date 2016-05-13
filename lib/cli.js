var _ = require('lodash'),
    configLoader = require('./config'),
    p = require('bluebird'),
    pkg = require('../package'),
    setup = require('./setup');

var commonOptions = [ 'config' ];

module.exports = {
  configureProgram: function(program) {
    return program
      .version(pkg.version)
      .option('-c, --config <path>', 'use a custom configuration file (defaults to ~/.lair/config.yml)', '~/.lair/config.yml')
      .option('--trace', 'print detailed message and stack trace when an error occurs');
  },

  parseOptions: parseOptions,
  parseCommonOptions: parseCommonOptions,
  parseAllOptions: parseAllOptions,

  setup: function(program, setupOptions) {
    return p.all([
      configLoader(parseCommonOptions(program)),
      setupOptions
    ]).spread(setup);
  },

  loadConfig: function(program) {
    return configLoader(parseCommonOptions(program));
  }
};

function parseOptions(options) {

  var additionalOptions = {},
      optionNames = Array.prototype.slice.call(arguments, 1);

  if (_.isObject(_.last(optionNames))) {
    additionalOptions = optionNames.pop();
  }

  return _.extend(_.pick(options, _.flatten(optionNames)), additionalOptions);
}

function parseCommonOptions(program) {
  return parseOptions(program, commonOptions);
}

function parseAllOptions(program, options) {
  return _.extend(parseCommonOptions(program), parseOptions(options, _.flatten(Array.prototype.slice.call(arguments, 2))));
}
