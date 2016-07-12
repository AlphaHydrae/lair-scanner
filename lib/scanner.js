var _ = require('lodash'),
    apiFactory = require('./api'),
    db = require('./db'),
    errors = require('./errors'),
    fs = require('fs-extra'),
    minimatch = require('minimatch'),
    moment = require('moment'),
    p = require('bluebird'),
    path = require('path'),
    ProgressBar = require('progress'),
    yaml = require('js-yaml');

module.exports = function(config) {
  return new Scanner(config);
};

function Scanner(config) {
  this.api = apiFactory(config);
  this.config = config;
  this.sources = [];
  this.resource = {};
  this._loaded = false;
}

_.extend(Scanner.prototype, {

  load: function() {

    var self = this,
        scannerIdfile = path.join(this.config.workspace, 'scannerId');

    return p.resolve().then(loadScannerId).then(loadSources);

    function loadScannerId() {
      if (!fs.existsSync(scannerIdfile)) {
        return saveScannerId();
      }

      return fs.readFileAsync(scannerIdfile, { encoding: 'utf-8' }).then(function(contents) {

        var id = contents.split('\n')[0].trim();
        if (!id.length) {
          return saveScannerId();
        }

        self.resource.id = id;
        return loadScanner();
      });
    }

    function loadScanner() {
      return self.api.mediaScanners.retrieve(self.resource.id).then(function(scanner) {
        self.resource = scanner;
      });
    }

    function saveScannerId() {
      return self.api.mediaScanners.create().then(function(scanner) {
        self.resource = scanner;
        return fs.writeFileAsync(scannerIdfile, scanner.id).return(scanner.id);
      });
    }

    function loadSources() {
      return self.api.mediaSources.findAll({
        userId: self.resource.userId,
        include: 'scanPaths'
      }).then(function(sources) {

        self.sources = sources;
        self._loaded = true;

        return p.all(_.map(sources, function(source) {
          return db.getSource(source.id).then(function(data) {
            return _.extend(source, data);
          });
        }));
      });
    }
  },

  findSources: function(sourceNames) {
    return _.filter(this.sources, function(source) {
      return !sourceNames || !sourceNames.length || _.includes(sourceNames, source.name);
    });
  },

  listFiles: function(source, emitter) {
    return p.reduce(source.scanPaths, function(memo, scanPath) {
      return readFilesRecursive(source, path.join(source.localPath, scanPath.path), 3, {
        readFile: _.bind(emitter.emit, emitter, 'readFile')
      });
    }, null);
  },

  syncFiles: function(source, emitter, options) {

    var state = {
      filesCount: 0,
      previousFilesCount: 0,
      newFilesCount: 0,
      deletedFilesCount: 0,
      changedFilesCount: 0,
      identicalFilesCount: 0
    };

    var self = this;
    return p.resolve().then(function() {
      return db.deleteFiles();
    }).then(function() {
      if (options.dryRun) {
        return;
      }

      return createScan(self.api, self.resource, source, emitter, state);
    }).then(function() {
      emitter.emit('downloadingFiles', source);
      return fetchFiles(self.api, source, emitter).tap(function(files) {
        state.previousFilesCount = files.length;
        emitter.emit('downloadedFiles', source, files);
      });
    }).then(function() {
      emitter.emit('scanningFiles');
      return processLocalFiles(source, self.config, emitter, state);
    }).then(function() {

      state.filesCount = state.newFilesCount + state.changedFilesCount + state.identicalFilesCount;
      if (state.changedFilesCount + state.identicalFilesCount < state.previousFilesCount) {
        state.deletedFilesCount = state.previousFilesCount - state.changedFilesCount - state.identicalFilesCount;
      }

      var promise = listDeletedFiles(source, emitter).then(function() {
        emitter.emit('scannedFiles', state);
      });

      if (!options.dryRun) {
        promise = promise.then(function() {
          return uploadFiles(self.api, self.resource, source, emitter, state);
        });
      }

      return promise;
    }).then(function() {
      if (options.dryRun) {
        return;
      }

      return endScan(self.api, source, emitter, state);
    }).return(state);
  },

  createSource: function(data) {
    return p.resolve().then(_.bind(postToApi, this)).then(_.bind(add, this));

    function add(source) {
      this.sources.push(source);
      return source;
    }

    function postToApi() {
      return this.api.mediaSources.create(data);
    }
  }
});

function fetchFiles(api, source, emitter) {
  return p.reduce(source.scanPaths, function(memo, scanPath) {
    return api.mediaFiles.findAll({
      mine: 1,
      type: 'file',
      sourceId: source.id,
      directory: scanPath.path,
      number: 500
    }, {
      emitter: emitter
    }).then(function(files) {
      return p.all(_.map(files, function(file) {
        return db.saveFile(source, _.pick(file, 'path', 'size', 'fileCreatedAt', 'fileModifiedAt', 'properties'));
      })).return(memo.concat(files));
    });
  }, []);
}

function processLocalFiles(source, config, emitter, state) {
  return p.reduce(source.scanPaths, function(memo, scanPath) {
    return readFilesRecursive(source, path.join(source.localPath, scanPath.path), 3, {
      readingDir: _.bind(emitter.emit, emitter, 'readingDir'),
      readDir: _.bind(emitter.emit, emitter, 'readDir'),
      processedDir: _.bind(emitter.emit, emitter, 'processedDir'),
      processedFile: _.bind(emitter.emit, emitter, 'processedFile'),
      readFile: function(currentPath, stats, source, depth) {
        if (_.some(config.ignores, function(ignore) {
          return minimatch(currentPath, ignore);
        })) {
          emitter.emit('ignoreFile', currentPath, stats, source, depth);
        } else {
          emitter.emit('readFile', currentPath, stats, source, depth);
          return processFile(source, currentPath, stats, state);
        }
      }
    });
  }, null);
}

function listDeletedFiles(source, emitter) {
  return db.streamFiles(source, function(file) {
    if (!file.status) {
      file.status = 'deleted';
      emitter.emit('deletedFile', file);
    }
  });
}

function createScan(api, resource, source, emitter, state) {
  emitter.emit('creatingScan', source);
  return api.mediaScans.create({
    sourceId: source.id,
    scannerId: resource.id
  }).then(function(scan) {
    state.scan = scan;
    emitter.emit('createdScan', source, scan);
  });
}

function endScan(api, source, emitter, state) {
  emitter.emit('endingMediaScan', source);
  return api.mediaScans.update(state.scan.id, {
    state: 'scanned',
    filesCount: state.filesCount
  }).tap(function() {
    emitter.emit('endedMediaScan', source);
  });
}

function uploadFiles(api, resource, source, emitter, state) {

  var filesToUpload = [],
      uploadPromise = p.resolve();

  return db.streamFiles(source, function(file) {
    if (file.status == 'identical') {
      return;
    }

    if (!file.status) {
      file.status = 'deleted';
    }

    filesToUpload.push(file);

    if (filesToUpload.length == 100) {

      var files = filesToUpload.slice();
      uploadPromise = uploadPromise.then(function() {
        emitter.emit('uploadingFiles', files.length);
        return uploadFilesBatch(api, state.scan, files).then(function() {
          emitter.emit('uploadedFiles', files.length);
        });
      });

      filesToUpload.length = 0;
    }
  }).then(function() {
    if (filesToUpload.length) {
      uploadPromise = uploadPromise.then(function() {
        emitter.emit('uploadingFiles', filesToUpload.length);
        return uploadFilesBatch(api, state.scan, filesToUpload).then(function() {
          emitter.emit('uploadedFiles', filesToUpload.length);
        });
      });
    }

    return uploadPromise;
  });
}

function uploadFilesBatch(api, scan, files) {
  return api.mediaScans.addFiles(scan, _.map(files, function(file) {

    var result = {
      path: file.path,
      change: file.status
    };

    if (result.change == 'deleted') {
      return result;
    }

    _.extend(result, _.pick(file, 'size', 'properties'));

    if (file.fileCreatedAt) {
      result.fileCreatedAt = moment(file.fileCreatedAt).toISOString();
    }

    if (file.fileModifiedAt) {
      result.fileModifiedAt = moment(file.fileModifiedAt).toISOString();
    }

    return result;
  }));
}

function readFilesRecursive(source, currentPath, maxDepth, callbacks, basePath, depth) {
  if (maxDepth <= 0) {
    return;
  }

  depth = depth || 0;
  basePath = basePath || currentPath;

  return fs.lstatAsync(currentPath).then(function(stats) {
    if (stats.isDirectory(currentPath) && depth < maxDepth - 1) {
      if (typeof(callbacks.readingDir) == 'function') {
        callbacks.readingDir(currentPath, stats, source, depth);
      }

      return fs.readdirAsync(currentPath).then(function(files) {
        if (typeof(callbacks.readDir) == 'function') {
          callbacks.readDir(currentPath, stats, files.length, source, depth);
        }

        return p.reduce(files, function(memo, file) {
          return readFilesRecursive(source, path.join(currentPath, file), maxDepth, callbacks, basePath, depth + 1);
        }, null);
      }).then(function() {
        if (typeof(callbacks.processedDir) == 'function') {
          callbacks.processedDir(currentPath, stats, source, depth);
        }
      });
    } else if (stats.isFile(currentPath)) {

      var promise = p.resolve();

      if (typeof(callbacks.readFile) == 'function') {
        promise = promise.then(function() {
          return callbacks.readFile(currentPath, stats, source, depth);
        });
      }

      if (typeof(callbacks.processedFile) == 'function') {
        promise.then(function(result) {
          callbacks.processedFile(currentPath, stats, source, depth, result);
        });
      }

      return promise;
    }
  });
}

function processFile(source, currentPath, stats, state) {

  var relativePath = '/' + path.relative(source.localPath, currentPath);

  return p.all([
    db.getFile(source, relativePath),
    getFileProperties(source, currentPath, stats)
  ]).spread(function(file, fileProperties) {
    if (file) {

      var changes = detectChanges(stats, file, fileProperties);
      if (changes.length) {
        state.changedFilesCount++;
        return db.saveFile(source, _.extend(file, {
          size: stats.size,
          fileCreatedAt: stats.birthtime.toISOString(),
          fileModifiedAt: stats.mtime.toISOString(),
          properties: fileProperties,
          changes: changes,
          status: 'changed'
        }));
      } else {
        state.identicalFilesCount++;
        return db.saveFile(source, _.extend(file, {
          status: 'identical'
        }));
      }
    } else {
      state.newFilesCount++;
      return db.saveFile(source, {
        path: relativePath,
        size: stats.size,
        fileCreatedAt: stats.birthtime.getTime(),
        fileModifiedAt: stats.mtime.getTime(),
        properties: fileProperties,
        status: 'added'
      });
    }
  });
}

function detectChanges(stats, file, fileProperties) {

  var fromStats = _.extend({
    size: stats.size,
    fileCreatedAt: moment(stats.birthtime).startOf('minute').toISOString(),
    fileModifiedAt: moment(stats.mtime).startOf('minute').toISOString(),
    properties: _.extend({}, fileProperties)
  });

  var fromFile = _.pick(file, 'size', 'fileCreatedAt', 'fileModifiedAt', 'properties');
  fromFile.fileCreatedAt = moment(fromFile.fileCreatedAt).startOf('minute').toISOString();
  fromFile.fileModifiedAt = moment(fromFile.fileModifiedAt).startOf('minute').toISOString();

  // TODO: add option to compare file creation date
  return _.reduce([ 'size', 'fileModifiedAt', 'properties' ], function(memo, attr) {
    if (!_.isEqual(fromStats[attr], fromFile[attr])) {
      memo.push({
        attribute: attr,
        previousValue: fromFile[attr]
      });
    }

    return memo;
  }, []);
}

function getFileProperties(source, currentPath, stats) {
  switch (path.extname(currentPath).replace(/^\./, '')) {
    case 'nfo':
      return fs.readFileAsync(currentPath).then(function(contents) {
        var match = /https?:\/\/[^\s]+/.exec(contents);
        if (match) {
          return {
            url: match[0]
          };
        }
      });
    case 'yml':
      return fs.readFileAsync(currentPath).then(function(contents) {
        try {
          contents = yaml.safeLoad(contents);
          if (!_.isObject(contents)) {
            // TODO: add warning
            return {};
          }

          return _.pick(contents, 'format', 'languages', 'subtitles');
        } catch (err) {
          // TODO: add warning
          return {};
        }
      });
    default:
      return {};
  }
}
