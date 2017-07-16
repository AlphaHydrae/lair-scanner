'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const apiFactory = require('./api');

module.exports = function(config) {
  return new Scanner(config);
};

function Scanner(config) {
  this.api = apiFactory(config);
  this.config = config;
  this.resource = {};
  this._loaded = false;
}

_.extend(Scanner.prototype, {

  load: function() {

    var self = this;

    return BPromise
      .resolve()
      .then(loadScanner);

    function loadScanner() {
      if (!self.config.scannerId) {
        return createScanner().then(saveScannerId);
      } else {
        return fetchScanner();
      }
    }

    function fetchScanner() {
      return self.api.mediaScanners.retrieve(self.config.scannerId).then(function(scanner) {
        self.resource = scanner;
      });
    }

    function createScanner() {
      return self.api.mediaScanners.create().then(function(scanner) {
        self.resource = scanner;
      });
    }

    function saveScannerId(scanner) {
      self.config.scannerId = self.resource.id;
      return self.config.save();
    }
  },

  loadSource: function(name) {
    return this.api.mediaSources.findOne({
      mine: 1,
      name: name,
      include: 'scanPaths'
    }).then(source => source ? this.enrichSource(source) : undefined);
  },

  loadSources: function() {
    if (this._sourcesPromise) {
      return this._sourcesPromise;
    }

    const names = _.toArray(arguments);
    const query = {
      mine: 1,
      include: 'scanPaths'
    };

    if (names.length) {
      query.name = names;
    }

    this._sourcesPromise = this.api.mediaSources.findAll(query).map(source => this.enrichSource(source));
    return this._sourcesPromise;
  },

  enrichSource: function(source) {

    const sourcePaths = this.resource.properties.sourcePaths || {};
    const localPath = sourcePaths[source.id];
    if (localPath) {
      source.localPath = localPath;
    }

    return source;
  },

  createSource: function(data) {
    return BPromise
      .resolve()
      .then(() => this.api.mediaSources.create(data))
      .then(source => this.saveSourceLocalPath(source, data.path));
  },

  saveSourceLocalPath: function(source, localPath) {
    return this.api.mediaScanners.update(this.resource, {
      properties: {
        sourcePaths: {
          [source.id]: localPath
        }
      }
    }).then(scanner => {
      this.resource = scanner;
      source.localPath = localPath;
      return source;
    });
  }
});
