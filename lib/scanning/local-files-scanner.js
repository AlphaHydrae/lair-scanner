'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const fs = require('fs-extra');
const path = require('path');

class LocalFilesScanner {
  constructor(source, scanner) {
    this.source = source;
    this.scanner = scanner;
    this.maxDepth = 5;
  }

  scan() {
    if (this.maxDepth <= 0) {
      return;
    }

    console.log('@@@ scanning');
    return BPromise.reduce(this.source.scanPaths, (memo, scanPath) => {
      return this.scanPath(scanPath);
    }, null);
  }

  scanPath(scanPath) {
    console.log('@@@ scan path', scanPath.path);

    const state = {
      sourcePath: this.source.localPath,
      scanPath: scanPath.path,
      currentPath: path.join(this.source.localPath, scanPath.path),
      depth: 0
    };

    return this.scanPathRecursive(state);
  }

  scanPathRecursive(state) {
    return fs.lstatAsync(state.currentPath).then(stat => {
      if (stat.isDirectory() && state.depth < this.maxDepth - 1) {
        console.log('@@@ reading directory', state.currentPath);

        return fs.readdirAsync(state.currentPath).then(files => {
          console.log('@@@ read directory', state.currentPath, files.length);

          return BPromise.reduce(files, (memo, file) => {
            return this.scanPathRecursive(_.extend({}, state, { currentPath: path.join(state.currentPath, file), depth: state.depth + 1 }));
          }, null);
        }).then(() => {
          console.log('@@@ finished reading directory', state.currentPath);
        });
      } else if (stat.isFile(state.currentPath)) {
        console.log('@@@ read file', state.currentPath);
      }
    });
  }
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

module.exports = LocalFilesScanner;
