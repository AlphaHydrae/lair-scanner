'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const chalk = require('chalk');
const configLoader = require('./config');
const fs = require('fs');
const log = require('./log');

module.exports = function(scanner) {
  const data = {};

  return BPromise
    .resolve()
    .then(loadSources)
    .then(print);

  function loadSources() {
    return scanner
      .loadSources()
      .then(sources => data.sources = sources);
  }

  function print() {
    log.newLine();

    if (!data.sources.length) {
      log.muted('You have no media sources defined.');
      return;
    }

    _.each(data.sources, function(source) {

      let description = source.name;
      if (source.localPath) {
        description += ` (in ${chalk.bold(source.localPath)})`;
      } else {
        description += `   ${chalk.yellow('unknown location')}`;
      }

      console.log(description);

      _.each(source.scanPaths, function(scanPath) {
        console.log('- ' + scanPath.path + ' (' + scanPath.category + ')');
      });

      console.log();
    });
  }
};
