var _ = require('underscore'),
    events = require('events'),
    level = require('level'),
    p = require('bluebird'),
    path = require('path'),
    uuid = require('uuid');

var db,
    cols = {},
    fileIds = [],
    previousFileId = 0;

module.exports = {
  open: function(config) {
    return p.promisify(level)(dbPath(config.workspace), {
      valueEncoding: 'json'
    }).then(function(openedDb) {
      db = openedDb;
    });
  },

  getFile: function(source, path) {
    return getValue('file-' + source.id + '-' + path);
  },

  streamFiles: function(source, func) {
    return new p(function(resolve, reject) {
      db.createReadStream({
        gte: 'file-' + source.id + '-',
        lte: 'file-zzzzzzzzzzzzzzzzzzzzzzzzzz-'
      })
        .on('data', function(data) {
          func(data.value);
        })
        .on('error', reject)
        .on('end', resolve);
    });
  },

  saveFile: function(source, data) {

    var batch = db.batch()
      .put('file-' + source.id + '-' + data.path, data);

    return new p(function(resolve, reject) {
      batch.write(function(err) {
        return err ? reject(err) : resolve();
      });
    }).return(data);
  }
};

function dbPath(workspace) {
  return path.join(workspace, 'db');
}

function getValue(key) {
  return new p(function(resolve, reject) {
    db.get(key, function(err, value) {
      if (err && err.notFound) {
        return resolve(null);
      } else {
        return err ? reject(err) : resolve(value);
      }
    });
  });
}
