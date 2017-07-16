'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const apiFactory = require('./api');
const db = require('./db');
const errors = require('./errors');
const fs = require('fs-extra');
const minimatch = require('minimatch');
const moment = require('moment');
const path = require('path');
const ProgressBar = require('progress');
const yaml = require('js-yaml');

module.exports = function(config) {
  return new Scanner(config);
};

function Scanner(config) {
  this.api = apiFactory(config);
  this.config = config;
  this.resource = {};
  this._loaded = false;
}

_.extend(Scanner.prototype, {

  load: function() {

    var self = this;

    return BPromise
      .resolve()
      .then(loadScanner);

    function loadScanner() {
      if (!self.config.scannerId) {
        return createScanner().then(saveScannerId);
      } else {
        return fetchScanner();
      }
    }

    function fetchScanner() {
      return self.api.mediaScanners.retrieve(self.config.scannerId).then(function(scanner) {
        self.resource = scanner;
      });
    }

    function createScanner() {
      return self.api.mediaScanners.create().then(function(scanner) {
        self.resource = scanner;
      });
    }

    function saveScannerId(scanner) {
      self.config.scannerId = self.resource.id;
      return self.config.save();
    }
  },

  loadSource: function(name) {
    return this.api.mediaSources.findOne({
      mine: 1,
      name: name,
      include: 'scanPaths'
    }).then(source => source ? this.enrichSource(source) : undefined);
  },

  loadSources: function() {
    if (this._sourcesPromise) {
      return this._sourcesPromise;
    }

    const names = _.toArray(arguments);
    const query = {
      mine: 1,
      include: 'scanPaths'
    };

    if (names.length) {
      query.name = names;
    }

    this._sourcesPromise = this.api.mediaSources.findAll(query).map(source => this.enrichSource(source));
    return this._sourcesPromise;
  },

  enrichSource: function(source) {

    const sourcePaths = this.resource.properties.sourcePaths || {};
    const localPath = sourcePaths[source.id];
    if (localPath) {
      source.localPath = localPath;
    }

    return source;
  },

  listFiles: function(source, emitter) {
    return BPromise.reduce(source.scanPaths, function(memo, scanPath) {
      return readFilesRecursive(source, path.join(source.localPath, scanPath.path), 5, {
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
    return BPromise.resolve().then(function() {
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
    return BPromise
      .resolve()
      .then(() => this.api.mediaSources.create(data))
      .then(source => this.saveSourceLocalPath(source, data.path));
  },

  saveSourceLocalPath: function(source, localPath) {
    return this.api.mediaScanners.update(this.resource, {
      properties: {
        sourcePaths: {
          [source.id]: localPath
        }
      }
    }).then(scanner => {
      this.resource = scanner;
      source.localPath = localPath;
      return source;
    });
  }
});

function fetchFiles(api, source, emitter) {
  return BPromise.reduce(source.scanPaths, function(memo, scanPath) {
    return api.mediaFiles.findAll({
      mine: 1,
      type: 'file',
      sourceId: source.id,
      directory: scanPath.path,
      number: 500
    }, {
      emitter: emitter
    }).then(function(files) {
      return BPromise.all(_.map(files, function(file) {
        return db.saveFile(source, _.pick(file, 'path', 'size', 'fileCreatedAt', 'fileModifiedAt', 'properties'));
      })).return(memo.concat(files));
    });
  }, []);
}

function processLocalFiles(source, config, emitter, state) {
  return BPromise.reduce(source.scanPaths, function(memo, scanPath) {
    return readFilesRecursive(source, path.join(source.localPath, scanPath.path), 5, {
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
      uploadPromise = BPromise.resolve();

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

        return BPromise.reduce(files, function(memo, file) {
          return readFilesRecursive(source, path.join(currentPath, file), maxDepth, callbacks, basePath, depth + 1);
        }, null);
      }).then(function() {
        if (typeof(callbacks.processedDir) == 'function') {
          callbacks.processedDir(currentPath, stats, source, depth);
        }
      });
    } else if (stats.isFile(currentPath)) {

      var promise = BPromise.resolve();

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

  return BPromise.all([
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
