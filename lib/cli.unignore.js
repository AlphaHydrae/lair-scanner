'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const chalk = require('chalk');
const cli = require('./cli');
const errors = require('./errors');
const log = require('./log');
const program = require('commander');
const sourcesUi = require('./ui.sources');

require('./promisify');

module.exports = function(argv) {

  cli.configureProgram(program);

  program.usage('[options] patterns');

  program.parse(argv || process.argv);

  perform(scanner => {
    if (program.args.length) {
      return unignorePatterns(scanner, program.args);
    } else {
      errors.log(new Error('At least one pattern is required'));
    }
  });

  function perform(op) {
    return BPromise
      .resolve()
      .then(log.newLine)
      .then(setup)
      .then(op)
      .then(log.newLine)
      .catch(errors.handler());
  }

  function setup() {
    return cli.setup(program, {
      check: false
    });
  }

  function unignorePatterns(scanner, patterns) {
    const logger = scanner.config.logger('ignore');
    return scanner.api.mediaSettings.retrieve().then(settings => {
      const updates = {
        ignores: _.difference(settings.ignores, patterns)
      };

      return scanner.api.mediaSettings.update(updates).then(settings => {
        logger.info();

        if (!settings.ignores.length) {
          return logger.info(chalk.green('No global ignore patterns defined'));
        }

        logger.info(chalk.green('Global ignore patterns:'));
        _.each(settings.ignores, pattern => logger.info(pattern));
      });
    });
  }
};
