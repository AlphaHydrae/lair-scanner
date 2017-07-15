'use strict';

const BPromise = require('bluebird');
const EventEmitter = require('events');

class RemoteFilesDownloader extends EventEmitter {
  constructor(source, scanner) {
    super();
    this.source = source;
    this.scanner = scanner;
  }

  download() {
    console.log('@@@ downloading');
    return BPromise.reduce(this.source.scanPaths, (memo, scanPath) => {
      return this.downloadBatch(scanPath);
    }, null);
  }

  downloadBatch(scanPath, start) {

    start = start || 0;
    const options = {
      emitter: this,
      response: true
    };

    return this.scanner.api.mediaFiles.find({
      type: 'file',
      sourceId: this.source.id,
      directory: scanPath.path,
      start: start,
      number: 2
    }, options).then(res => {
      res.body.forEach(file => console.log(`@@@ downloaded ${file.path}`));
      if (res.pagination().hasMoreRecords) {
        return this.downloadBatch(scanPath, start + 1);
      }
    });
  }
}

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

module.exports = RemoteFilesDownloader;
