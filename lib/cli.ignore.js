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

  program.usage('[options] [patterns]');

  program.parse(argv || process.argv);

  perform(scanner => {
    if (program.args.length) {
      return ignorePatterns(scanner, program.args);
    } else {
      return listIgnores(scanner);
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

  function listIgnores(scanner) {
    const logger = scanner.config.logger('ignore');
    return scanner.api.mediaSettings.retrieve().then(settings => {

      const ignores = settings.ignores;
      if (!ignores.length) {
        return logger.info(chalk.green('No global ignore patterns defined'));
      }

      logger.info();
      logger.info(chalk.green('Global ignore patterns:'));
      _.each(ignores, pattern => logger.info(pattern));
    });
  }

  function ignorePatterns(scanner, patterns) {
    const logger = scanner.config.logger('ignore');
    return scanner.api.mediaSettings.retrieve().then(settings => {

      const currentIgnores = settings.ignores;
      const alreadyIgnored = _.intersection(patterns, currentIgnores).length >= 1;
      const updates = {
        ignores: _.union(currentIgnores, patterns)
      };

      return scanner.api.mediaSettings.update(updates).then(settings => {
        logger.info();

        let message = chalk.green('Global ignore patterns');
        if (alreadyIgnored) {
          message += ' (the ones in yellow were already ignored)';
        }

        logger.info(`${message}${chalk.green(':')}`);
        _.each(settings.ignores, pattern => {
          if (!_.includes(patterns, pattern)) {
            logger.info(pattern);
          } else if (_.includes(currentIgnores, pattern)) {
            logger.info(chalk.yellow(pattern));
          } else {
            logger.info(chalk.green(pattern));
          }
        });
      });
    });
  }
};
