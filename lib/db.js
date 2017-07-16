'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const bigInt = require('big-integer');
const events = require('events');
const level = require('level');
const path = require('path');
const tmp = require('tmp');
const uuid = require('uuid');

tmp.setGracefulCleanup();

var db,
    cols = {},
    fileIds = [],
    previousFileId = 0;

const DATABASE = Symbol('database');

class Database {
  constructor(config) {
    this.id = uuid.v4();
    this.logger = config.logger('db');
  }

  open(path) {
    if (!path) {
      return this.openInTmpDir();
    } else {
      return this.openInDir(path);
    }
  }

  openInDir(path) {
    if (this[DATABASE]) {
      return BPromise.reject(new Error('Database is already open'));
    }

    return BPromise.promisify(level)(path, {
      valueEncoding: 'json'
    }).then(db => {
      this[DATABASE] = db
      this.logger.trace(`Opened database ${this.id} in ${path}`);
      return this;
    });
  }

  openInTmpDir() {
    this.logger.trace(`Creating a temporary directory to open a database ${this.id}`);
    return tmp.dirAsync({ prefix: 'lair-scanner-', unsafeCleanup: true }).then(path => {
      return this.openInDir(path);
    });
  }

  saveValue(key, value) {
    const batch = this[DATABASE].batch().put(key, value);
    return new BPromise((resolve, reject) => {
      batch.write(err => {
        return err ? reject(err) : resolve();
      });
    }).tap(() => {
      if (this.logger.isTraceEnabled()) {
        this.logger.trace(`PUT ${key} = ${JSON.stringify(value)}`);
      }
    }).return(value);
  }

  saveValues(keyValueMap) {
    return new BPromise((resolve, reject) => {
      if (_.isEmpty(keyValueMap)) {
        return resolve(keyValueMap);
      }

      const batch = _.reduce(keyValueMap, (memo, value, key) => {
        return memo.put(key, value);
      }, this[DATABASE].batch());

      batch.write(err => {
        return err ? reject(err) : resolve(keyValueMap);
      });
    }).tap(() => {
      if (this.logger.isTraceEnabled()) {
        const keys = _.keys(keyValueMap);
        this.logger.trace(`PUT ${keys.length} values`);
        _.each(keys, key => this.logger.trace(`    ${key} = ${JSON.stringify(keyValueMap[key])}`));
      }
    });
  }

  getValue(key) {
    return new BPromise((resolve, reject) => {
      this[DATABASE].get(key, (err, value) => {
        if (err && err.notFound) {
          return resolve();
        } else {
          return err ? reject(err) : resolve(value);
        }
      });
    }).tap(value => {
      if (this.logger.isTraceEnabled()) {
        this.logger.trace(`GET ${key} - ${value ? JSON.stringify(value) : 'undefined'}`);
      }
    });
  }

  listKeyValues(startKey, endKey, limit) {
    if (!_.isInteger(limit) || limit < -1) {
      throw new Error('Limit must be an integer greater than or equal to -1');
    }

    return new BPromise((resolve, reject) => {
      const keyValueMap = {};
      this[DATABASE].createReadStream({
        gte: startKey,
        lt: endKey,
        limit: limit
      })
        .on('data', data => keyValueMap[data.key] = data.value)
        .on('error', reject)
        .on('end', () => resolve(keyValueMap));
    });
  }

  streamValues(startKey, endKey, callback) {
    return new BPromise((resolve, reject) => {
      this[DATABASE].createReadStream({
        gte: startKey,
        lt: endKey
      })
        .on('data', data => callback(data.value, data.key))
        .on('error', reject)
        .on('end', resolve);
    });
  }

  deleteValue(key) {
    return new BPromise((resolve, reject) => {
      const batch = this[DATABASE].batch().del(key);
      batch.write(err => {
        return err ? reject(err) : resolve();
      });
    }).tap(() => {
      if (this.logger.isTraceEnabled()) {
        this.logger.trace(`DELETE ${key}`);
      }
    }).return(key);
  }

  deleteValues() {
    const keys = _.flatten(_.toArray(arguments));
    return new BPromise((resolve, reject) => {
      const batch = _.reduce(keys, (memo, key) => memo.del(key), this[DATABASE].batch());
      batch.write(err => {
        return err ? reject(err) : resolve();
      });
    }).tap(() => {
      if (this.logger.isTraceEnabled()) {
        this.logger.trace(`DELETE ${keys.length} keys`);
        _.each(keys, key => this.logger.trace(`    ${key}`));
      }
    }).return(keys);
  }

  close() {
    if (!this[DATABASE]) {
      return BPromise.reject(new Error('Database is not open'));
    }

    return new BPromise((resolve, reject) => {
      this[DATABASE].close(err => {
        return err ? reject(err) : resolve();
      })
    }).then(() => this.logger.trace(`Closed database ${this.id}`));
  }
}

module.exports = function(config) {
  return new Database(config);
};
