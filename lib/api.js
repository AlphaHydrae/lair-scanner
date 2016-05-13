var _ = require('lodash'),
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
    options.headers.Authorization = 'Bearer ' + authToken;

    return new p(function(resolve, reject) {
      request(options, function(err, res, body) {
        if (err) {
          reject(err);
        } else {
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

    var data = [];

    return api(options).then(function(res) {
      if (!_.has(res.headers, 'x-pagination-filtered-total')) {
        return res;
      }

      var filteredTotal = parseInt(res.headers['x-pagination-filtered-total'], 10);
      if (!_.isInteger(filteredTotal)) {
        return res;
      }

      data = data.concat(res.body);

      if (filteredTotal > options.start + options.number) {
        options.qs.start += options.qs.number;
        return api(options);
      }

      return _.extend(res, {
        body: data
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
        url: '/media/scanners/' + id
      }).then(retrievedHandler('retrieve media scanner ' + id));
    },

    update: function(data) {
      return api({
        method: 'PATCH',
        url: '/media/scanners/' + data.id,
        body: data || {}
      }).then(updatedHandler('update media scanner ' + data.id));
    },

    updateProperties: function(id, properties) {
      return api({
        method: 'PATCH',
        url: '/media/scanners/' + id + '/properties',
        body: properties || {}
      }).then(updatedHandler('update properties of media scanner ' + id));
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

    addFiles: function(scan, data) {
      return api({
        method: 'POST',
        url: '/media/scans/' + scan.id + '/files',
        body: data
      }).then(createdHandler(data, 'add files to media scan', { code: 200 }));
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

    findOne: function(query) {
      return api({
        url: '/media/sources',
        qs: _.extend({}, query, {
          number: 1
        })
      }).then(retrievedHandler('find one media source matching ' + JSON.stringify(query || {}))).then(function(results) {
        return results.length ? results[0] : null;
      });
    },

    findAll: function(query) {
      // TODO: handle pagination
      return api({
        url: '/media/sources',
        qs: query || {}
      }).then(retrievedHandler('find media sources matching ' + JSON.stringify(query || {})));
    },

    retrieve: function(id) {
      return api({
        url: '/media/sources/' + id
      }).then(retrievedHandler('retrieve media source ' + id));
    },

    update: function(id, data) {
      return api({
        method: 'PATCH',
        url: '/media/sources/' + id,
        body: data
      }).then(updatedHandler('update media source ' + id));
    },

    delete: function(id) {
      return api({
        method: 'DELETE',
        url: '/media/sources/' + id
      }).then(deletedHandler('delete media source ' + id));
    },

    createScanPath: function(mediaSource, data) {
      return api({
        method: 'POST',
        url: '/media/sources/' + mediaSource.id + '/scanPaths',
        body: data
      }).then(createdHandler(data, 'create scan path for media source ' + mediaSource.name + ' (' + mediaSource.id + ')'));
    }
  };

  api.mediaFiles = {
    findAll: function(query) {
      return api.all({
        url: '/media/files',
        qs: _.extend({}, query)
      }).then(retrievedHandler('find media files matching ' + JSON.stringify(_.extend({}, query))));
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
      throw errors.unexpectedServerResponse('Could not ' + description + ' in the Lair media center', res, { expected: ('' + (options.code || '201')) });
    }
  };
}

function retrievedHandler(description) {
  return function(res) {
    if (res.statusCode == 200) {
      return res.body;
    } else {
      throw errors.unexpectedServerResponse('Could not ' + description + ' in the Lair media center', res, { expected: '200' });
    }
  };
}

function updatedHandler(description) {
  return function(res) {
    if (res.statusCode == 200) {
      return res.body;
    } else {
      throw errors.unexpectedServerResponse('Could not ' + description + ' in the Lair media center', res, { expected: '200' });
    }
  };
}

function deletedHandler(description) {
  return function(res) {
    if (res.statusCode == 204) {
      return;
    } else {
      throw errors.unexpectedServerResponse('Could not ' + description + ' in the Lair media center', res, { expected: '204' });
    }
  };
}
