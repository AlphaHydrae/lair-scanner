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

  saveSource: function(id, source) {
    return saveValue('source-' + id, _.pick(source, 'localPath'));
  },

  getSource: function(id) {
    return getValue('source-' + id);
  },

  saveFile: function(source, data) {
    return saveValue('file-' + source.id + '-' + data.path, data);
  },

  getFile: function(source, path) {
    return getValue('file-' + source.id + '-' + path);
  },

  streamFiles: function(source, func) {
    return new p(function(resolve, reject) {
      getDb().createReadStream({
        gte: 'file-' + source.id + '-',
        lte: 'file-zzzzzzzzzzzzzzzzzzzzzzzzzz-'
      })
        .on('data', function(data) {
          func(data.value);
        })
        .on('error', reject)
        .on('end', resolve);
    });
  }
};

function dbPath(workspace) {
  return path.join(workspace, 'db');
}

function getDb() {
  if (!db) {
    throw new Error('Database has not been opened');
  }

  return db;
}

function getValue(key) {
  return new p(function(resolve, reject) {
    getDb().get(key, function(err, value) {
      if (err && err.notFound) {
        return resolve(null);
      } else {
        return err ? reject(err) : resolve(value);
      }
    });
  });
}

function saveValue(key, value) {

  var batch = getDb().batch()
    .put(key, value);

  return new p(function(resolve, reject) {
    batch.write(function(err) {
      return err ? reject(err) : resolve();
    });
  }).return(value);
}
