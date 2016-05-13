var _ = require('lodash'),
    db = require('./db'),
    errors = require('./errors'),
    events = require('events'),
    log = require('./log'),
    p = require('bluebird'),
    path = require('path'),
    ProgressBar = require('progress'),
    ui = require('./ui'),
    scanPathsUi = require('./ui.scanPaths');

module.exports = {
  add: function(scanner, options) {
    options = _.extend({}, options);

    var source,
        data = {
          name: options.name,
          path: options.path
        };

    return p.resolve()
      .then(askForName)
      .then(askForLocalPath)
      .then(checkName)
      .then(createSource)
      .then(addScanPath).then(function() {
        return source;
      });

    function askForName(message) {
      if (!data.name) {
        return ui.askFor(message || 'Choose a name for the media source:').then(function(answer) {
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

    function checkName() {

      log.start('Checking media source name...');

      return findMediaSource(scanner, data.name).catch(log.stopErrorHandler()).then(function(existing) {
        if (existing) {
          log.stop('warn', 'taken');

          var name = data.name;
          delete data.name;

          return askForName('The name "' + name + '" is already taken, please choose another one:').then(checkName);
        } else {
          log.stop('success', 'done');
        }
      });
    }

    function createSource() {

      log.start('Creating media source...');

      return scanner.createSource(data).catch(log.stopErrorHandler()).then(function(createdSource) {
        log.stop('success', 'done');
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
      if (options.scanPath) {
        if (options.scanPath === true) {
          log.message('\nTo scan files, you must add a scan path.');
        }

        return scanPathsUi.create(scanner, source, {
          path: options.scanPath === true ? null : options.scanPath,
          category: options.scanPathCategory
        });
      }
    }
  },

  scan: function(scanner, options) {

    var sources;
    if (options.name) {
      var source = _.find(scanner.sources, { name: options.name });
      if (!source.localPath) {
        throw errors.build('Source ' + options.name + ' has not been located on this machine');
      }

      sources = [ source ];
    } else {
      sources = _.filter(scanner.sources, function(source) {
        return !!source.localPath;
      });

      if (!sources.length) {
        throw errors.build('No source has been located on this machine');
      }
    }

    return p.reduce(sources, function(memo, source) {
      return scanSource(scanner, source, options);
    }, null);
  },

  rename: function(scanner, options) {
    return ensureMediaSourceExists(scanner, options.oldName).then(function(source) {

      log.start('Checking new media source name...');
      return findMediaSource(scanner, options.newName).catch(log.stopErrorHandler()).then(function(existing) {
        if (existing) {
          log.stop('warn', 'taken');
          throw errors.build('The name "' + options.newName + '" is already taken.');
        }

        log.stop('success', 'done');

        log.start('Renaming media source...');
        return scanner.api.mediaSources.update(source.id, {
          name: options.newName
        }).catch(log.stopErrorHandler()).then(function() {
          log.stop('success', 'done');
        });
      });
    });
  },

  remove: function(scanner, options) {
    return ensureMediaSourceExists(scanner, options.name).then(function(source) {
      log.start('Deleting media source...');
      return scanner.api.mediaSources.delete(source.id).catch(log.stopErrorHandler()).then(function() {
        log.stop('success', 'done');
      });
    });
  }
};

function ensureMediaSourceExists(scanner, name) {

  log.start('Checking media source...');

  return findMediaSource(scanner, name).then(function(source) {
    if (!source) {
      log.stop('warn', 'not found');
      throw errors.build('You don\'t have a media source named "' + name + '"');
    }

    log.stop('success', 'done');
    return source;
  });
}

function findMediaSource(scanner, name) {
  return scanner.api.mediaSources.findOne({
    mine: 1,
    name: name
  }).catch(log.stopErrorHandler());
}

function scanSource(scanner, currentSource, options) {

  var localProgress,
      uploadProgress,
      emitter = new events.EventEmitter();

  emitter.on('creatingScan', function(source) {
    log.start('Starting scan for ' + source.name);
  });

  emitter.on('createdScan', function(source, scan) {
    log.stop('success', 'done');
  });

  emitter.on('downloadingFiles', function(source) {
    log.start('Downloading file list for ' + source.name);
  });

  emitter.on('downloadedFiles', function(source, files) {
    log.stop('success', files.length + ' ' + ui.pluralize('file', files.length));
  });

  emitter.on('readDir', function(path, stats, filesCount, source, depth) {
    if (depth === 0) {
      localProgress = new ProgressBar('[:bar] :percent :name', {
        total: filesCount * 2,
        width: 50,
        clear: true
      });
    }
  });

  var n = 0;
  emitter.on('readingDir', function(currentPath, stats, source, depth) {
    if (localProgress && depth == 1) {
      localProgress.tick({ name: path.basename(currentPath) });
    }
  });

  emitter.on('processedDir', function(currentPath, stats, source, depth) {
    if (localProgress && depth == 1) {
      localProgress.tick({ name: path.basename(currentPath) });
    }
  });

  emitter.on('processedFile', function(currentPath, stats, source, depth) {
    if (localProgress && depth == 1) {
      localProgress.tick();
      localProgress.tick();
    }
  });

  emitter.on('scannedFiles', function(state) {

    var filesToUpload = state.newFilesCount + state.deletedFilesCount + state.modifiedFilesCount;
    if (filesToUpload >= 1) {
      log.title('Uploading data...');
    }

    if (filesToUpload >= 2) {
      uploadProgress = new ProgressBar('[:bar] :percent', {
        total: filesToUpload,
        width: 50,
        clear: true
      });
    }
  });

  emitter.on('uploadedFiles', function(count) {
    if (uploadProgress) {
      _.times(count, function() {
        uploadProgress.tick();
      });
    }
  });

  emitter.on('endingMediaScan', function() {
    log.start('Ending scan');
  });

  emitter.on('endedMediaScan', function() {
    log.stop('success', 'done');
  });

  log.newLine();
  log.title('Scanning source ' + currentSource.name + '...');

  return scanner.syncFiles(currentSource, emitter, options)
    .tap(log.newLine)
    .then(function(result) {

      var summaryData = {};

      if (result.newFilesCount) {
        summaryData.added = result.newFilesCount + ' files added';
      }

      if (result.changedFilesCount) {
        summaryData.changed = result.changedFilesCount + ' files modified';
      }

      if (result.deletedFilesCount) {
        summaryData.removed = result.deletedFilesCount + ' files deleted';
      }

      if (result.identicalFilesCount) {
        summaryData.identical = result.identicalFilesCount + ' files unchanged';
      }

      log.summary(summaryData);
    });
}
