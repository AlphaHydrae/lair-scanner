var _ = require('lodash'),
    apiPagination = require('./api.pagination'),
    errors = require('./errors'),
    p = require('bluebird'),
    request = require('request'),
    urls = require('./urls');

module.exports = factory;

function factory(config) {

  var serverUrl = config.server.url,
      authToken = config.server.token;

  function api(options) {
    options = _.extend({}, options);

    options.method = options.method || 'GET';
    options.url = urls.join(serverUrl, 'api', options.url);

    if (!_.has(options, 'json')) {
      options.json = true;
    }

    options.headers = options.headers || {};
    options.headers.Authorization = `Bearer ${authToken}`;

    var emitter = options.emitter;

    return new p(function(resolve, reject) {
      request(_.omit(options, 'emitter'), function(err, res, body) {
        if (err) {
          reject(err);
        } else {
          res.pagination = function() {
            if (!res._pagination) {
              res._pagination = apiPagination(res);
            }

            return res._pagination;
          };

          if (emitter) {
            emitter.emit('api:response', res);
          }

          resolve(res);
        }
      });
    });
  }

  api.all = function(options) {
    options = _.extend({}, options);

    options.qs = _.extend({}, options.qs, {
      start: _.get(options, 'qs.start', 0),
      number: _.get(options, 'qs.number', 100)
    });

    options.qsStringifyOptions = {
      arrayFormat: 'brackets'
    };

    _.defaults(options, {
      allData: []
    });

    return api(options).then(function(res) {
      if (!_.has(res.headers, 'x-pagination-filtered-total')) {
        return res;
      }

      var filteredTotal = parseInt(res.headers['x-pagination-filtered-total'], 10);
      if (!_.isInteger(filteredTotal)) {
        return res;
      }

      options.allData = options.allData.concat(res.body);

      if (res.pagination().hasMoreRecords) {
        options.qs.start += options.qs.number;
        return api.all(options);
      }

      return _.extend(res, {
        body: options.allData
      });
    });
  };

  api.root = {
    retrieve: function() {
      return api({
        url: '/'
      }).then(retrievedHandler('retrieve API information'));
    }
  };

  api.mediaScanners = {
    create: function(data) {
      return api({
        method: 'POST',
        url: '/media/scanners',
        body: data || {}
      }).then(createdHandler(data, 'create media scanner'));
    },

    retrieve: function(id) {
      return api({
        url: `/media/scanners/${id}`,
      }).then(retrievedHandler(`retrieve media scanner ${id}`));
    },

    update: function(scanner, data) {
      return api({
        method: 'PATCH',
        url: `/media/scanners/${scanner.id}`,
        body: data || {}
      }).then(updatedHandler(`update media scanner ${scanner.id}`));
    }
  };

  api.mediaScans = {
    create: function(data) {
      return api({
        method: 'POST',
        url: '/media/scans',
        body: data
      }).then(createdHandler(data, 'create media scan'));
    },

    update: function(id, data) {
      return api({
        method: 'PATCH',
        url: `/media/scans/${id}`,
        body: _.extend({}, data)
      }).then(updatedHandler(`update media scan ${id}`));
    },

    addChanges: function(scan, data) {
      return api({
        method: 'POST',
        url: `/media/scans/${scan.id}/changes`,
        body: data
      }).then(createdHandler(data, 'add changes to media scan'));
    }
  };

  api.mediaSettings = {
    retrieve: function() {
      return api({
        url: '/media/settings'
      }).then(retrievedHandler(`retrieve media settings`));
    },

    update: function(data) {
      return api({
        method: 'PATCH',
        url: '/media/settings',
        body: data
      }).then(updatedHandler('update media settings'));
    }
  };

  api.mediaSources = {
    create: function(data) {
      return api({
        method: 'POST',
        url: '/media/sources',
        body: data
      }).then(createdHandler(data, 'create media source'));
    },

    count: function(query, options) {
      return api(_.extend({}, options, {
        method: 'HEAD',
        url: '/media/sources',
        qs: _.extend({}, query, {
          number: 0
        })
      })).then(countHandler(`count media sources matching ${JSON.stringify(query || {})}`)).then(function(res) {
        return parseInt(res.headers['x-pagination-filtered-total'], 10);
      });
    },

    findOne: function(query, options) {
      return api(_.extend({}, options, {
        url: '/media/sources',
        qs: _.extend({}, query, {
          number: 1
        })
      })).then(retrievedHandler(`find one media source matching ${JSON.stringify(query || {})}`)).then(function(results) {
        return results.length ? results[0] : null;
      });
    },

    findAll: function(query, options) {
      return api.all(_.extend({}, options, {
        url: '/media/sources',
        qs: query
      })).then(retrievedHandler(`find media sources matching ${JSON.stringify(query || {})}`));
    },

    retrieve: function(id) {
      return api({
        url: `/media/sources/${id}`
      }).then(retrievedHandler(`retrieve media source ${id}`));
    },

    update: function(id, data) {
      return api({
        method: 'PATCH',
        url: `/media/sources/${id}`,
        body: data
      }).then(updatedHandler(`update media source ${id}`));
    },

    delete: function(id) {
      return api({
        method: 'DELETE',
        url: `/media/sources/${id}`
      }).then(deletedHandler(`delete media source ${id}`));
    },

    createScanPath: function(source, data) {
      return api({
        method: 'POST',
        url: `/media/sources/${source.id}/scanPaths`,
        body: data
      }).then(createdHandler(data, `create scan path for media source ${source.name} (${source.id})`));
    },

    findOneScanPath: function(source, query, options) {
      return api(_.extend({}, options, {
        url: `/media/sources/${source.id}/scanPaths`,
        qs: _.extend({}, query, {
          number: 1
        })
      })).then(retrievedHandler(`find one scan path matching ${JSON.stringify(query || {})} in media source ${source.name} (${source.id})`)).then(function(results) {
        return results.length ? results[0] : null;
      });
    },

    deleteScanPath: function(source, scanPath) {
      return api({
        method: 'DELETE',
        url: `/media/sources/${source.id}/scanPaths/${scanPath.id}`
      }).then(deletedHandler(`delete scan path ${scanPath.path} for media source ${source.name} (${source.id})`));
    }
  };

  api.mediaFiles = {
    find: function(query, options) {
      return api(_.extend({}, options, {
        url: '/media/files',
        qs: _.extend({}, query)
      })).then(retrievedHandler(`find media files matching ${JSON.stringify(query || {})}`, options));
    },

    findAll: function(query, options) {
      return api.all(_.extend({}, options, {
        url: '/media/files',
        qs: _.extend({}, query)
      })).then(retrievedHandler(`find media files matching ${JSON.stringify(query || {})}`, options));
    }
  };

  api.mediaSearches = {
    findAll: function(query, options) {
      return api.all(_.extend({}, options, {
        url: '/media/searches',
        qs: _.extend({}, query)
      })).then(retrievedHandler(`find media searches matching ${JSON.stringify(query || {})}`));
    }
  };

  return api;
}

function createdHandler(data, description, options) {
  options = options || {};

  return function(res) {
    if (res.statusCode == (options.code || 201)) {
      return _.extend({}, data, res.body);
    } else {
      throw errors.unexpectedServerResponse(`Could not ${description} in the Lair media center`, res, { expected: ('' + (options.code || '201')) });
    }
  };
}

function countHandler(description) {
  return function(res) {
    if (res.statusCode == 200) {
      return res;
    } else {
      throw errors.unexpectedServerResponse(`Could not ${description} in the Lair media center`, res, { expected: '200' });
    }
  };
}

function retrievedHandler(description, options) {
  options = options || {};

  return function(res) {
    if (res.statusCode == 200) {
      return options.response ? res : res.body;
    } else {
      throw errors.unexpectedServerResponse(`Could not ${description} in the Lair media center`, res, { expected: '200' });
    }
  };
}

function updatedHandler(description) {
  return function(res) {
    if (res.statusCode == 200) {
      return res.body;
    } else {
      throw errors.unexpectedServerResponse(`Could not ${description} in the Lair media center`, res, { expected: '200' });
    }
  };
}

function deletedHandler(description) {
  return function(res) {
    if (res.statusCode == 204) {
      return;
    } else {
      throw errors.unexpectedServerResponse(`Could not ${description} in the Lair media center`, res, { expected: '204' });
    }
  };
}
