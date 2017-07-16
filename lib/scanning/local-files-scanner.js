'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const EventEmitter = require('events');
const fs = require('fs-extra');
const moment = require('moment');
const path = require('path');

class LocalFilesScanner extends EventEmitter {
  constructor(source, scanner, db) {
    super();

    this.source = source;
    this.scanner = scanner;
    this.db = db;

    this.maxDepth = 5;
    this.directoryFiles = {};
    this.logger = scanner.config.logger('local-files-scanner');
  }

  scan() {
    if (this.maxDepth <= 0) {
      return;
    }

    return this.listScanPathFiles()
      .then(() => BPromise.reduce(this.source.scanPaths, (memo, scanPath) => this.scanPath(scanPath), null));
  }

  listScanPathFiles() {
    return BPromise.all(_.map(this.source.scanPaths, scanPath => this.listDirectory(path.join(this.source.localPath, scanPath.path), 0)));
  }

  listDirectory(currentPath, depth) {
    if (this.directoryFiles[currentPath]) {
      return BPromise.resolve(this.directoryFiles[currentPath]);
    }

    this.logger.trace(`Listing directory ${currentPath}`);
    return fs.readdirAsync(currentPath).then(files => {
      this.directoryFiles[currentPath] = files;

      this.emit('directory:listed', {
        depth: depth,
        files: files,
        path: currentPath
      });

      return files;
    });
  }

  scanPath(scanPath) {

    const state = {
      scanPath: scanPath,
      currentPath: path.join(this.source.localPath, scanPath.path),
      depth: 0
    };

    return this.scanPathRecursive(state);
  }

  scanPathRecursive(state) {
    // Check if file or directory
    return fs.lstatAsync(state.currentPath).then(stat => {
      if (stat.isDirectory() && state.depth < this.maxDepth - 1) {
        // List directory
        this.emit('directory:listing', {
          depth: state.depth,
          path: state.currentPath
        });

        return this.listDirectory(state.currentPath, state.depth).then(files => {
          return BPromise.reduce(files, (memo, file) => {
            // Recursively scan files
            return this.scanPathRecursive(_.extend(Object.create(state), {
              currentPath: path.join(state.currentPath, file),
              depth: state.depth + 1
            }));
          }, null);
        }).then(() => this.emit('directory:scanned', {
          depth: state.depth,
          path: state.currentPath
        }));
      } else if (stat.isFile(state.currentPath)) {
        // Read file
        this.emit('file:scanning', {
          depth: state.depth,
          path: state.currentPath
        });

        this.logger.trace(`Reading file ${state.currentPath}`);
        return BPromise.resolve().delay(150).then(() => {
          return this.getFileProperties(state.currentPath).then(properties => this.saveFile(state, stat, properties));
        });
      }
    });
  }

  saveFile(state, stat, properties) {
    const relativePath = `/${path.relative(this.source.localPath, state.currentPath)}`;
    return this.db.saveValue(this.getFileKey(relativePath), {
      path: relativePath,
      size: stat.size,
      fileCreatedAt: moment(stat.birthtime.getTime()).startOf('second').toISOString(),
      fileModifiedAt: moment(stat.mtime.getTime()).startOf('second').toISOString(),
      properties: properties
    }).then(file => this.emit('file:scanned', _.extend(file, {
      depth: state.depth
    })));
  }

  getFile(currentPath) {
    return this.db.getValue(this.getFileKey(currentPath));
  }

  streamFiles(callback) {
    return this.db.streamValues('2-', '3-', callback);
  }

  deleteFile(currentPath) {
    return this.db.deleteValue(this.getFileKey(currentPath));
  }

  getFileKey(currentPath) {
    return `2-scanned-file-${currentPath}`;
  }

  getFileProperties(currentPath) {
    switch (path.extname(currentPath).replace(/^\./, '')) {
      case 'nfo':
        return fs.readFileAsync(currentPath).then(contents => {
          const match = /https?:\/\/[^\s]+/.exec(contents);
          if (match) {
            return {
              url: match[0]
            };
          }
        });
      case 'yml':
        return fs.readFileAsync(currentPath).then(contents => {
          try {
            contents = yaml.safeLoad(contents);
            if (!_.isObject(contents)) {
              this.logger.warn(`File ${currentPath} does not represent an object`);
              return {};
            }

            return contents;
          } catch (err) {
            this.logger.warn(`File ${currentPath} is not a valid YAML file: ${err.message}`);
            return {};
          }
        });
      default:
        return BPromise.resolve({});
    }
  }
}

module.exports = LocalFilesScanner;