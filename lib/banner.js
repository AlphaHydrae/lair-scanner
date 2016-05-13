var fs = require('fs-extra'),
    log = require('./log'),
    p = require('bluebird'),
    path = require('path');

module.exports = {
  print: function() {
    return p.resolve().then(readBanner).then(printBanner);
  }
};

function readBanner() {
  return fs.readFileAsync(path.resolve(path.join(__dirname, '..', 'resources', 'banner.txt')), { encoding: 'utf-8' });
}

function printBanner(banner) {
  log.banner(banner);
}
