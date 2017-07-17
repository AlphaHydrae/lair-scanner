'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const configLoader = require('./config');
const errors = require('./errors');
const log = require('./log');
const pkg = require('../package');
const program = require('commander');
const setup = require('./setup');

const commonOptions = [ 'config', 'logLevel' ];

module.exports = {
  configureProgram: configureProgram,
  parseOptions: parseOptions,
  parseCommonOptions: parseCommonOptions,
  parseAllOptions: parseAllOptions,
  setup: setupProgram,

  loadConfig: function(program) {
    return configLoader(parseCommonOptions(program));
  },

  program: function(callback, setupOptions) {
    return function(argv) {
      return BPromise.resolve().then(() => {
        configureProgram(program);

        let action;
        let defaultAction = _.noop;

        const configuration = callback(program, function(actionCallback) {
          return function() {
            if (action) {
              throw new Error('Only one program action may be executed');
            }

            const commanderArgs = _.toArray(arguments);
            action = performAction(_.partial.apply(_, [ actionCallback, _ ].concat(commanderArgs)), program, setupOptions);
          };
        }, function(defaultCallback) {
          defaultAction = defaultCallback;
        });

        return BPromise.resolve(configuration).then(() => {
          program.parse(argv || process.argv);

          if (action) {
            return action;
          }

          return performAction(_.partial(defaultAction, _, program), program, setupOptions);
        });
      }).catch(errors.handler());
    };
  }
};

function performAction(op, program, setupOptions) {
  return BPromise
    .resolve()
    .then(log.newLine)
    .then(_.partial(setupProgram, program, setupOptions))
    .then(op)
    .then(log.newLine);
}

function setupProgram(program, setupOptions) {
  return BPromise.all([
    configLoader(parseCommonOptions(program)),
    setupOptions
  ]).spread(setup);
}

function configureProgram(program) {
  return program
    .version(pkg.version)
    .option('-c, --config <path>', 'use a custom configuration file (defaults to ~/.lair/config.yml)', '~/.lair/config.yml')
    .option('--log-level <level>', 'set a custom log level (TRACE, DEBUG, INFO, WARN, ERROR, FATAL); defaults to INFO')
    .option('--trace', 'print detailed message and stack trace when an error occurs');
}

function parseOptions(options) {

  var additionalOptions = {},
      optionNames = Array.prototype.slice.call(arguments, 1);

  if (_.isPlainObject(_.last(optionNames))) {
    additionalOptions = optionNames.pop();
  }

  return _.extend(_.pick(options, _.flatten(optionNames)), additionalOptions);
}

function parseCommonOptions(program) {
  return parseOptions.apply(undefined, [ program ].concat(commonOptions));
}

function parseAllOptions(program, options) {
  return _.extend(parseCommonOptions(program), parseOptions(options, _.flatten(Array.prototype.slice.call(arguments, 2))));
}
