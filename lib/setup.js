'use strict';

const _ = require('lodash');
const errors = require('./errors');
const log = require('./log');
const p = require('bluebird');
const scannerFactory = require('./scanner');
const scanPathsUi = require('./ui.scanPaths');
const sourcesUi = require('./ui.sources');
const ui = require('./ui');
const configureUi = require('./ui.configure');

module.exports = function(config, options) {
  options = _.defaults({}, options);

  let scanner;

  return p.resolve([ config, options ])
    .spread(configureUi)
    .then(loadScanner)
    .then(checkSources)
    .then(function() {
      return scanner;
    });

  function checkSources() {
    if (!_.get(options, 'check', true)) {
      return;
    }

    return scanner.loadSources().then(sources => {
      if (!sources.length) {
        log.message('\nTo scan media files, you must define at least one source.');
        return sourcesUi.add(scanner, { scanPath: true });
      } else if (sources.length == 1 && (!sources[0].scanPaths || !sources[0].scanPaths.length)) {
        log.message(`\nTo scan media files in ${sources[0].name}, you must define a scan path.`);
        return scanPathsUi.create(scanner, sources[0]);
      }
    });
  }

  function loadScanner() {
    scanner = scannerFactory(config);
    return scanner.load();
  }
};
