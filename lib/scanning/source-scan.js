'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const chalk = require('chalk');
const db = require('../db');
const LocalFilesScanner = require('./local-files-scanner');
const path = require('path');
const prettyBytes = require('pretty-bytes');
const ProgressBar = require('progress');
const RemoteFilesDownloader = require('./remote-files-downloader');

const COMPARISON_ATTRIBUTES = [ 'size', 'fileModifiedAt', 'properties' ];
const UPLOAD_ATTRIBUTES = [ 'path', 'change', 'size', 'fileCreatedAt', 'fileModifiedAt', 'properties' ];
const UPLOAD_BATCH_SIZE = 2;

class SourceScan {
  constructor(source, scanner, options) {
    this.db = db(scanner.config);
    this.source = source;
    this.scanner = scanner;

    this.options = _.pick(options, 'dryRun', 'listIdentical');
    this.options.list = options.list || options.listIdentical;

    this.logger = scanner.config.logger('scan');
    this.localScanner = new LocalFilesScanner(this.source, this.scanner, this.db);
    this.remoteDownloader = new RemoteFilesDownloader(this.source, this.scanner, this.db);
    this.comparisonPromises = [];
  }

  scan() {
    if (this.scanning) {
      throw new Error('Already scanning');
    }

    this.scanning = true;
    this.localScanner.on('file:scanned', file => this.onLocalFileScanned(file));
    this.remoteDownloader.on('file:downloaded', file => this.onRemoteFileDownloaded(file));

    this.currentFile = '';
    this.filesDownloaded = 0;
    this.firstLevelFilesScanned = 0;
    this.changesToUpload = 0;

    this.remoteDownloader.on('total', total => {
      this.filesToDownload = total;
      this.startProgress();
    });

    this.remoteDownloader.on('batch:downloaded', files => {
      this.filesDownloaded += files.length;
      this.tickProgress(files.length)
    });

    let remainingScanPathCount = this.source.scanPaths.length;
    this.localScanner.on('directory:listed', directory => {
      if (directory.depth === 0) {
        if (this.firstLevelFilesToScan === undefined) {
          this.firstLevelFilesToScan = 0;
        }

        remainingScanPathCount--;
        this.firstLevelFilesToScan += directory.files.length;
        if (remainingScanPathCount <= 0) {
          this.startProgress();
        }
      }
    });

    this.localScanner.on('directory:scanned', directory => {
      if (directory.depth === 1) {
        this.firstLevelFilesScanned++;
        this.tickProgress();
      }
    });

    this.localScanner.on('file:scanning', file => {
      this.updateScanningProgress(file);
    });

    this.localScanner.on('directory:listing', directory => {
      this.updateScanningProgress(directory);
    });

    this.localScanner.on('file:scanned', file => {
      if (file.depth === 1) {
        this.firstLevelFilesScanned++;
        this.tickProgress();
      }
    });

    return this.db.open()
      .then(() => this.createScan())
      .then(() => BPromise.all([
        this.localScanner.scan(),
        this.remoteDownloader.download()
      ]))
      .then(() => BPromise.all(this.comparisonPromises))
      .then(() => BPromise.all([
        this.saveNewLocalFiles(),
        this.saveDeletedRemoteFiles()
      ]))
      .then(() => this.processChanges())
      .then(() => this.uploadRemainingChanges())
      .then(() => this.completeScan())
      .then(() => this.db.close());
  }

  createScan() {
    if (this.options.dryRun) {
      return;
    }

    return this.scanner.api.mediaScans.create({
      sourceId: this.source.id,
      scannerId: this.scanner.resource.id
    }).then(scan => {
      // TODO: rename to scan
      this.apiScan = scan;
    });
  }

  startProgress() {
    if (this.filesToDownload !== undefined && this.firstLevelFilesToScan !== undefined) {
      this.progress = this.filesDownloaded + this.firstLevelFilesScanned;
      this.totalProgress = this.filesToDownload + this.firstLevelFilesToScan;

      if (!this.logger.isDebugEnabled() && !this.progressBar) {
        this.progressBar = new ProgressBar('[:bar] :dl% dl :scan% scan :file', {
          curr: this.progress,
          total: this.totalProgress,
          width: 50,
          clear: true
        });
      }
    }
  }

  tickProgress(n) {
    this.progress += (n || 1);
    this.logger.trace(`Scan progress is ${this.progress}/${this.totalProgress}`);

    if (this.progressBar) {
      this.progressBar.tick(n || 1, this.getProgressBarTokens());
    }
  }

  updateScanningProgress(file) {
    if (!this.progressBar) {
      return;
    }

    this.currentFile = path.basename(file.path);
    if (this.currentFile.length > 50) {
      this.currentFile = `${this.currentFile.substring(0, 47)}...`;
    }

    this.progressBar.render(this.getProgressBarTokens());
  }

  getProgressBarTokens() {
    return {
      file: this.currentFile,
      dl: this.filesToDownload ? Math.round(this.filesDownloaded * 100 / this.filesToDownload) : 100,
      scan: this.firstLevelFilesToScan ? Math.round(this.firstLevelFilesScanned * 100 / this.firstLevelFilesToScan) : 100
    };
  }

  onRemoteFileDownloaded(remoteFile) {
    const comparisonPromise = this.localScanner
      .getFile(remoteFile.path)
      .then(localFile => localFile ? this.compareFiles(localFile, remoteFile) : undefined);

    this.comparisonPromises.push(comparisonPromise);
    return comparisonPromise.then(() => _.pull(this.comparisonPromises, comparisonPromise));
  }

  onLocalFileScanned(localFile) {
    const comparisonPromise = this.remoteDownloader
      .getFile(localFile.path)
      .then(remoteFile => remoteFile ? this.compareFiles(localFile, remoteFile) : undefined);

    this.comparisonPromises.push(comparisonPromise);
    return comparisonPromise.then(() => _.pull(this.comparisonPromises, comparisonPromise));
  }

  compareFiles(localFile, remoteFile) {
    if (localFile.path != remoteFile.path) {
      throw new Error(`Cannot compare ${localFile.path} to ${remoteFile.path}`);
    }

    const currentPath = localFile.path;
    const changes = _.reduce(COMPARISON_ATTRIBUTES, (memo, property) => {

      const localValue = localFile[property];
      const remoteValue = remoteFile[property];
      if (!_.isEqual(localValue, remoteValue)) {
        memo[property] = remoteValue;
      }

      return memo;
    }, {});

    const change = _.isEmpty(changes) ? 'identical' : 'modified';
    this.logger.trace(`File ${currentPath} is ${change}`);

    let changeSavePromise = BPromise.resolve();
    if (change == 'modified' || this.options.listIdentical) {
      changeSavePromise = this.saveChangedFile(_.extend(localFile, {
        change: change,
        changes: changes
      }));
    }

    return BPromise.all([
      changeSavePromise,
      this.localScanner.deleteFile(currentPath),
      this.remoteDownloader.deleteFile(currentPath)
    ]);
  }

  processChanges() {
    if (this.progressBar) {
      this.progressBar.terminate();
    }

    let promise = BPromise
      .resolve()
      .then(() => this.logger.info());

    const countByChange = {
      added: 0,
      modified: 0,
      deleted: 0,
      identical: 0
    };

    // TODO: only stream all files if listing
    promise = promise.then(() => this.streamChangedFiles(file => {
      countByChange[file.change]++;
      if (this.options.list && (file.change != 'identical' || this.options.listIdentical)) {

        let message = this.getFileChangeMessage(file.change, file.path);
        if (file.change == 'modified') {

          const changesDescriptions = _.map(file.changes, (value, key) => {

            let oldValue = value;
            let newValue = file[key];

            if (key == 'size') {
              oldValue = prettyBytes(oldValue);
              newValue = prettyBytes(newValue);
            } else if (key == 'properties') {
              oldValue = JSON.stringify(oldValue);
              newValue = JSON.stringify(newValue);
            }

            return `${chalk.yellow(key) + chalk.yellow(':')} ${chalk.red(oldValue)} ${chalk.yellow('->')} ${chalk.green(newValue)}`;
          });

          message += `  ${changesDescriptions.join('  ')}`;
        }

        this.logger.info(message);
      }
    }));

    promise = promise
      .then(() => this.logger.info())
      .then(() => {
        this.logger.info(_.reduce(countByChange, (memo, count, change) => {
          if (count) {
            memo.push(this.getFileChangeMessage(change, `${count} ${change}`));
          }

          return memo;
        }, []).join(' ') || this.getFileChangeMessage('identical', 'no files scanned'));
      });

    return promise;
  }

  saveNewLocalFiles() {
    const promises = [];
    return this.localScanner.streamFiles(file => {
      promises.push(this.saveChangedFile(_.extend(file, {
        change: 'added'
      })));
    }).then(() => BPromise.all(promises));
  }

  saveDeletedRemoteFiles() {
    const promises = [];
    return this.remoteDownloader.streamFiles(file => {
      promises.push(this.saveChangedFile({
        path: file.path,
        change: 'deleted'
      }));
    }).then(() => BPromise.all(promises));
  }

  saveChangedFile(file) {
    return this.db.saveValue(this.getChangedFileKey(file.path), file).then(() => {
      if (file.change != 'identical') {
        return this.saveUpload(file);
      }
    });
  }

  saveUpload(file) {
    return this.db.saveValue(this.getUploadFileKey(file.path), file).then(() => {
      this.changesToUpload++;
      if (this.changesToUpload >= UPLOAD_BATCH_SIZE && !this.uploadPromise) {
        this.uploadPromise = this.uploadNextChanges();
      }
    });
  }

  uploadNextChanges(min) {
    if (this.options.dryRun) {
      return;
    }

    min = min || UPLOAD_BATCH_SIZE;

    return this.db.listKeyValues('3-', '4-', UPLOAD_BATCH_SIZE).then(keyValues => {
      return BPromise.all([
        this.uploadChanges(_.values(keyValues)),
        this.db.deleteValues(_.keys(keyValues))
      ]);
    }).then(() => {
      this.changesToUpload -= UPLOAD_BATCH_SIZE;
      if (this.changesToUpload >= min) {
        return this.uploadNextChanges(min);
      } else {
        delete this.uploadPromise;
      }
    });
  }

  uploadChanges(changes) {
    return this.scanner.api.mediaScans.addFiles(this.apiScan, changes.map(change => _.pick(change, UPLOAD_ATTRIBUTES)));
  }

  uploadRemainingChanges() {
    if (this.options.dryRun) {
      return;
    }

    const promise = this.uploadPromise || BPromise.resolve();
    return promise.then(() => {
      if (this.changesToUpload >= 1) {
        return this.uploadNextChanges(1);
      }
    });
  }

  completeScan() {
    if (this.options.dryRun) {
      return;
    }

    return this.scanner.api.mediaScans.update(this.apiScan.id, {
      state: 'scanned',
      filesCount: this.localScanner.totalFilesCount
    });
  }

  streamChangedFiles(callback) {
    return this.db.streamValues('0-', '1-', callback);
  }

  getUploadFileKey(currentPath) {
    return `3-upload-${currentPath}`;
  }

  getChangedFileKey(currentPath) {
    return `0-changed-file-${currentPath}`;
  }

  getFileChangeMessage(change, message) {
    if (change == 'added') {
      return chalk.black.bgGreen(message);
    } else if (change == 'identical') {
      return chalk.white.bgBlue(message);
    } else if (change == 'deleted') {
      return chalk.white.bgRed(message);
    } else if (change == 'modified') {
      return chalk.black.bgYellow(message);
    } else {
      throw new Error(`Unknown file change type ${change}`);
    }
  }
}

module.exports = SourceScan;
