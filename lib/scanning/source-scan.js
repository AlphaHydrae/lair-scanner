'use strict';

const BPromise = require('bluebird');
const LocalFilesScanner = require('./local-files-scanner');
const RemoteFilesDownloader = require('./remote-files-downloader');

class SourceScan {
  constructor(source, scanner, options) {
    this.source = source;
    this.scanner = scanner;
  }

  scan() {

    const localScanner = new LocalFilesScanner(this.source, this.scanner);
    const remoteDownloader = new RemoteFilesDownloader(this.source, this.scanner);

    return BPromise.all([
      localScanner.scan(),
      remoteDownloader.download()
    ]);
  }
}

module.exports = SourceScan;
