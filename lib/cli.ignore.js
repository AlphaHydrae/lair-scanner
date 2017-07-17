'use strict';

const _ = require('lodash');
const chalk = require('chalk');
const cli = require('./cli');

require('./promisify');

module.exports = cli.program(function(program, commandAction, defaultAction) {
  program
    .usage('[options] [patterns]')
    .description('Add filename patterns to ignore when scanning media files');

  defaultAction(scanner => {
    if (program.args.length) {
      return ignorePatterns(scanner, program.args);
    } else {
      return listIgnores(scanner);
    }
  });
}, { check: false });

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
