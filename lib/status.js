var _ = require('lodash'),
    chalk = require('chalk'),
    configLoader = require('./config'),
    fs = require('fs'),
    log = require('./log');

module.exports = function(scanner) {

  log.newLine();

  if (!scanner.sources.length) {
    log.muted('You have no media sources defined.');
  } else {
    _.each(scanner.sources, function(source) {

      var description = source.name;
      if (source.localPath) {
        description += ' (in ' + chalk.bold(source.localPath) + ')';
      }

      console.log(description);

      _.each(source.scanPaths, function(scanPath) {
        console.log('- ' + scanPath.path + ' (' + scanPath.category + ')');
      });

      console.log();
    });
  }
};
