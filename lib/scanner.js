var _ = require('lodash'),
    apiFactory = require('./api'),
    db = require('./db'),
    errors = require('./errors'),
    fs = require('fs-extra'),
    moment = require('moment'),
    p = require('bluebird'),
    path = require('path'),
    ProgressBar = require('progress');

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
        withScanPaths: 1
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
      return !sourceNames || !sourceNames.length || _.includes(sourceNames, source);
    });
  },

  listFiles: function(source, emitter) {
    return p.reduce(source.scanPaths, function(memo, scanPath) {
      return readFilesRecursive(source, path.join(source.localPath, scanPath.path), 3, {
        readFile: _.bind(emitter.emit, emitter, 'readFile')
      });
    }, null);
  },

  syncFiles: function(source, emitter) {

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
      emitter.emit('creatingScan', source);
      return createScan(self.api, self.resource, source).then(function(scan) {
        state.scan = scan;
        emitter.emit('createdScan', source, scan);
      });
    }).then(function() {
      emitter.emit('downloadingFiles', source);
      return fetchFiles(self.api, source).tap(function(files) {
        state.previousFilesCount = files.length;
        emitter.emit('downloadedFiles', source, files);
      });
    }).then(function() {
      emitter.emit('scanningFiles');
      return processLocalFiles(source, emitter, state);
    }).then(function() {

      state.filesCount = state.newFilesCount + state.changedFilesCount + state.identicalFilesCount;
      if (state.filesCount < state.previousFilesCount) {
        state.deletedFilesCount = state.previousFilesCount - state.filesCount;
      }

      emitter.emit('scannedFiles', state);

      return uploadFiles(self.api, self.resource, source, emitter, state);
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

function fetchFiles(api, source) {
  return p.reduce(source.scanPaths, function(memo, scanPath) {
    return api.mediaFiles.findAll({
      mine: 1,
      type: 'file',
      sourceId: source.id,
      directory: scanPath.path
    }).then(function(files) {
      return p.all(_.map(files, function(file) {
        return db.saveFile(source, _.pick(file, 'path', 'size', 'fileCreatedAt', 'fileModifiedAt'));
      })).return(memo.concat(files));
    });
  }, []);
}

function createScan(api, resource, source) {
  return api.mediaScans.create({
    sourceId: source.id,
    scannerId: resource.id
  });
}

function processLocalFiles(source, emitter, state) {
  return p.reduce(source.scanPaths, function(memo, scanPath) {
    return readFilesRecursive(source, path.join(source.localPath, scanPath.path), 3, {
      readingDir: _.bind(emitter.emit, emitter, 'readingDir'),
      readDir: _.bind(emitter.emit, emitter, 'readDir'),
      processedDir: _.bind(emitter.emit, emitter, 'processedDir'),
      processedFile: _.bind(emitter.emit, emitter, 'processedFile'),
      readFile: function(currentPath, stats, source, depth) {
        emitter.emit(currentPath, stats, source, depth);
        return processFile(source, currentPath, stats, state);
      }
    });
  }, null);
}

function uploadFiles(api, resource, source, emitter, state) {

  var filesToUpload = [],
      uploadPromise = p.resolve();

  return db.streamFiles(source, function(file) {
    if (file.status != 'identical') {
      filesToUpload.push(file);
    }

    if (filesToUpload.length == 100) {

      var files = filesToUpload.slice();
      uploadPromise = uploadPromise.then(function() {
        emitter.emit('uploadingFiles', files.length);
        return uploadScan(api, state.scan, files).then(function() {
          emitter.emit('uploadedFiles', files.length);
        });
      });

      filesToUpload.length = 0;
    }
  }).then(function() {
    if (filesToUpload.length) {
      uploadPromise = uploadPromise.then(function() {
        emitter.emit('uploadingFiles', filesToUpload.length);
        return uploadScan(api, state.scan, filesToUpload).then(function() {
          emitter.emit('uploadedFiles', filesToUpload.length);
        });
      });
    }

    return uploadPromise;
  }).then(function() {
    emitter.emit('endingMediaScan', source);
    return api.mediaScans.update(state.scan.id, {
      endedAt: new Date().toISOString()
    }).tap(function() {
      emitter.emit('endedMediaScan', source);
    });
  });
}

function uploadScan(api, scan, files) {
  return api.mediaScans.addFiles(scan, _.map(files, function(file) {
    var result = _.pick(file, 'path', 'size');

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

      promise.then(function() {
        if (typeof(callbacks.processedFile) == 'function') {
          callbacks.processedFile(currentPath, stats, source, depth);
        }
      });

      return promise;
    }
  });
}

function processFile(source, currentPath, stats, state) {

  var relativePath = '/' + path.relative(source.localPath, currentPath);

  return db.getFile(source, relativePath).then(function(file) {
    if (file) {
      if (stats.size != file.size || stats.mtime.toISOString() != file.fileModifiedAt) {
        state.changedFilesCount++;
        return db.saveFile(source, _.extend(file, {
          size: stats.size,
          fileCreatedAt: stats.birthtime.toISOString(),
          fileModifiedAt: stats.mtime.toISOString(),
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
        status: 'new'
      });
    }
  });
}
