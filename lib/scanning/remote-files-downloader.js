'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const EventEmitter = require('events');

const BATCH_SIZE = 2;

class RemoteFilesDownloader extends EventEmitter {
  constructor(source, scanner, db) {
    super();

    this.source = source;
    this.scanner = scanner;
    this.db = db;

    this.logger = scanner.config.logger('remote-files-downloader');
  }

  download() {
    return this.countFiles().then(BPromise.reduce(this.source.scanPaths, (memo, scanPath) => {
      return this.downloadBatch(scanPath);
    }, null));
  }

  countFiles() {
    return this.scanner.api.mediaFiles.findAll({
      type: 'directory',
      sourceId: this.source.id,
      path: _.map(this.source.scanPaths, 'path')
    })
      .then(directories => _.reduce(directories, (memo, directory) => memo + directory.filesCount, 0))
      .then(total => this.emit('total', total));
  }

  downloadBatch(scanPath, start) {

    start = start || 0;
    this.logger.trace(`Downloading batch ${start / BATCH_SIZE} (${start * BATCH_SIZE}-${(start * BATCH_SIZE) + BATCH_SIZE})`);

    const options = {
      response: true
    };

    return this.scanner.api.mediaFiles.find({
      type: 'file',
      sourceId: this.source.id,
      directory: scanPath.path,
      start: start,
      number: BATCH_SIZE
    }, options).then(res => {
      this.emit('batch:downloaded', res.body);

      let nextBatchPromise = BPromise.resolve();
      if (res.pagination().hasMoreRecords) {
        nextBatchPromise = BPromise.resolve().delay(150).then(() => {
          return this.downloadBatch(scanPath, start + BATCH_SIZE);
        });
      }

      return BPromise.all([
        this.saveFiles(res.body),
        nextBatchPromise
      ]).return();
    });
  }

  saveFiles(files) {
    return this.db.saveValues(_.reduce(files, (memo, file) => {
      const simplifiedFile = this.simplifyFile(file);
      memo[this.getFileKey(file.path)] = simplifiedFile;
      return memo;
    }, {})).then(savedFiles => _.each(savedFiles, file => this.emit('file:downloaded', file)));
  }

  getFile(currentPath) {
    return this.db.getValue(this.getFileKey(currentPath));
  }

  streamFiles(callback) {
    return this.db.streamValues('1-', '2-', callback);
  }

  deleteFile(currentPath) {
    return this.db.deleteValue(this.getFileKey(currentPath));
  }

  getFileKey(currentPath) {
    return `1-downloaded-file-${currentPath}`;
  }

  simplifyFile(file) {
    return _.pick(file, 'path', 'size', 'fileCreatedAt', 'fileModifiedAt', 'properties');
  }
}

module.exports = RemoteFilesDownloader;
