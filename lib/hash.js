var _ = require('underscore'),
    crypto = require('crypto'),
    events = require('events'),
    fs = require('fs'),
    p = require('bluebird'),
    path = require('path');

module.exports = function(file) {
  return new p(function(resolve, reject) {

    var pos = 0,
        size = 16777216,
        buf = new Buffer(size),
        shasum = crypto.createHash('sha1'),
        emitter = new events.EventEmitter();

    emitter.on('data', function(data) {
      shasum.update(data);
    });

    fs.open(file, 'r', function(err, fd) {
      if (err) {
        return reject(err);
      }

      readFileRecursive(fd, buf, size, emitter, 0).then(function() {
        fs.close(fd, function(err) {
          return err ? reject(err) : resolve(shasum.digest('hex'));
        });
      }, reject);
    });
  });
};

function readFileRecursive(fd, buf, size, emitter, pos, speed) {
  return new p(function(resolve, reject) {

    var start = new Date().getTime();

    fs.read(fd, buf, 0, size, pos, function(err, bytesRead, buf) {
      if (err) {
        return reject(err);
      } else if (bytesRead <= 0) {
        return resolve();
      }

      emitter.emit('data', buf.slice(0, bytesRead));

      var newSpeed = bytesRead / (new Date().getTime() - start);
      if (!speed || newSpeed < speed) {
        size = size / 2;
      } else if (speed && newSpeed > speed && size * 2 <= 16777216) {
        size = size * 2;
      }

      resolve(readFileRecursive(fd, buf, size, emitter, pos + bytesRead, newSpeed));
    });
  });
}
