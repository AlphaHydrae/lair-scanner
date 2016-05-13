var _ = require('underscore'),
    db = require('./db'),
    log = require('./log'),
    p = require('bluebird'),
    path = require('path'),
    ui = require('./ui'),
    scanPathsUi = require('./ui.scanPaths');

module.exports = {
  create: function(scanner, initialData) {

    var source,
        data = initialData || {};

    return p.resolve()
      .then(askForName)
      .then(askForLocalPath)
      .then(createSource)
      .then(addScanPath).then(function() {
        return source;
      });

    function askForName() {
      if (!data.name) {
        return ui.askFor('Choose a name for the media source:').then(function(answer) {
          data.name = answer;
        });
      }
    }

    function askForLocalPath() {
      if (!data.path) {
        return ui.askForDir('Enter the path to the directory containing the media files (auto-completion enabled):', '/').then(function(answer) {
          data.path = answer;
        });
      }
    }

    function createSource() {
      return scanner.createSource(data).then(function(createdSource) {
        source = createdSource;
        return source;
      }).then(function(createdSource) {
        createdSource.localPath = data.path;
        return saveLocalPath().return(createdSource);
      });
    }

    function saveLocalPath() {
      return db.saveSource(source.id, source);
    }

    function addScanPath() {
      if (data.scanPath) {
        if (data.scanPath === true) {
          log.message('\nTo scan files, you must add a scan path.');
        }

        return scanPathsUi.create(scanner, source, {
          path: data.scanPath === true ? null : data.scanPath,
          category: data.scanPathCategory
        });
      }
    }
  }
};
