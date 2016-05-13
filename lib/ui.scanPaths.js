var _ = require('lodash'),
    log = require('./log'),
    p = require('bluebird'),
    path = require('path'),
    ui = require('./ui');

module.exports = {
  create: function(scanner, source, initialData) {

    var data = initialData || {};

    return p.resolve()
      .then(askForScanPathCategory)
      .then(askForScanPath)
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
        data.path = '/' + path.relative(source.localPath, answer);
        return;
      });
    }

    function createScanPath() {
      return scanner.api.mediaSources.createScanPath(source, data).then(function(scanPath) {
        if (!source.scanPaths) {
          source.scanPaths = [];
        }

        source.scanPaths.push(scanPath);
      });
    }
  }
};
