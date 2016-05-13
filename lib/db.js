var _ = require('lodash'),
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
    return saveValue('source-' + normalizeId(id), _.pick(source, 'localPath'));
  },

  getSource: function(id) {
    return getValue('source-' + normalizeId(id));
  },

  saveFile: function(source, data) {
    return saveValue('file-' + normalizeId(source.id) + '-' + data.path, data);
  },

  getFile: function(source, path) {
    return getValue('file-' + normalizeId(source.id) + '-' + path);
  },

  streamFiles: function(source, func) {
    return new p(function(resolve, reject) {
      getDb().createReadStream({
        gte: 'file-' + source.id + '-',
        lt: 'file-' + nextId(source.id) + '-'
      })
        .on('data', function(data) {
          func(data.value);
        })
        .on('error', reject)
        .on('end', resolve);
    });
  },

  deleteFiles: function() {
    return new p(function(resolve, reject) {

      var db = getDB(),
          batch = db.batch();

      db.createKeyStream({
        gte: 'file-',
        lt: 'file-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-'
      })
        .on('data', function(key) {
          batch = batch.del(key);
        })
        .on('error', reject)
        .on('end', function() {
          batch.write(function(err) {
            if (err) {
              return reject(err);
            }

            resolve();
          });
        });
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

function normalizeId(id) {
  return '0' + id;
}

function nextId(id) {

  var length = id.length,
      next = (parseInt(id, '36') + 1).toString(36);

  return next.length > length ? next : normalizeId(next);
}
