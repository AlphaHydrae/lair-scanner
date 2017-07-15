var _ = require('lodash'),
    BPromise = require('bluebird'),
    errors = require('./errors'),
    fs = require('fs-extra'),
    log = require('./log'),
    path = require('path'),
    ui = require('./ui');

module.exports = {
  create: function(scanner, source, initialData) {

    var data = initialData || {};

    return BPromise.resolve()
      .then(askForScanPathCategory)
      .then(askForScanPath)
      .then(checkAndNormalizeScanPath)
      .then(createScanPath)
      .then(function() {
        return source;
      });

    function askForScanPathCategory(message) {
      if (data.category) {
        return;
      }

      var categories = [ 'anime', 'book', 'magazine', 'manga', 'movie', 'show' ];

      message = message || 'Enter the category of media in the scan path (' + categories.join('/') + '):';

      return ui.askFor(message).then(function(answer) {
        if (!_.includes(categories, answer)) {
          return askForScanPathCategory('Please enter a valid category:');
        } else {
          data.category = answer;
          return;
        }
      });
    }

    function askForScanPath(message) {
      if (data.path && data.path !== true) {
        return;
      }

      message = message || 'Enter the path to scan:';

      return ui.askForDir(message, source.localPath + '/').then(function(answer) {
        data.path = path.relative(source.localPath, answer);
        return;
      });
    }

    function checkAndNormalizeScanPath() {
      const absolutePath = path.join(source.localPath, data.path);
      return fs.statAsync(absolutePath).catch(function(err) {
        throw new Error(`${absolutePath} does not exist or is not accessible: ${err.message}`);
      }).then(function(stat) {
        if (!stat.isDirectory()) {
          throw new Error(`${absolutePath} is not a directory`);
        }

        data.path = normalizePath(data.path);
      });
    }

    function createScanPath() {
      log.start('Creating scan path...');
      return scanner.api.mediaSources.createScanPath(source, data).catch(log.stopErrorHandler()).then(function(scanPath) {
        log.stop('success', 'done');

        if (!source.scanPaths) {
          source.scanPaths = [];
        }

        source.scanPaths.push(scanPath);
      });
    }
  },

  remove: function(scanner, source, path) {
    path = normalizePath(path);

    return BPromise.resolve()
      .then(() => ensureScanPathExists(scanner, source, path))
      .then(deleteScanPath);

    function deleteScanPath(scanPath) {
      log.start('Removing scan path...');
      return scanner.api.mediaSources.deleteScanPath(source, scanPath).catch(log.stopErrorHandler()).then(() => {
        log.stop('success', 'done');
      });
    }
  }
};

function ensureScanPathExists(scanner, source, path) {
  log.start('Checking scan path...');

  return scanner.api.mediaSources.findOneScanPath(source, { path: path }).then(function(scanPath) {
    if (!scanPath) {
      log.stop('warn', 'not found');
      throw errors.build(`You don't have a scan path "${path}" in media source ${source.name} (${source.id})`);
    }

    log.stop('success', 'done');
    return scanPath;
  });
}

function normalizePath(path) {
  return `/${path.replace(/^\//, '').replace(/\/$/, '')}`;
}
