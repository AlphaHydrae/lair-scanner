var _ = require('underscore'),
    db = require('./db'),
    errors = require('./errors'),
    log = require('./log'),
    p = require('bluebird'),
    scannerFactory = require('./scanner'),
    scanPathsUi = require('./ui.scanPaths'),
    sourcesUi = require('./ui.sources'),
    ui = require('./ui'),
    configureUi = require('./ui.configure');

module.exports = function(options) {

  var config,
      scanner;

  return p.resolve(options)
    .then(configureUi)
    .then(function(loadedConfig) {
      config = loadedConfig;
    })
    .then(loadScanner)
    .then(openDatabase)
    .then(checkSources)
    .then(function() {
      return scanner;
    });

  function checkSources() {
    if (!scanner.sources.length) {
      log.message('\nTo scan media files, you must define at least one source.');
      return sourcesUi.create(scanner, { scanPath: true });
    } else if (scanner.sources.length == 1 && !scanner.sources[0].scanPaths || !scanner.sources[0].scanPaths.length) {
      log.message('\nTo scan media files for source ' + scanner.sources[0].name + ', you must define a scan path.');
      return scanPathsUi.create(scanner, scanner.sources[0]);
    }
  }

  function loadScanner() {
    scanner = scannerFactory(config);
    return scanner.load();
  }

  function openDatabase() {
    return db.open(config);
  }
};
