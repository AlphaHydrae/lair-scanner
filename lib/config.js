var _ = require('lodash'),
    expand = require('expand-tilde'),
    fs = require('fs-extra'),
    inflection = require('inflection'),
    p = require('bluebird'),
    path = require('path'),
    yaml = require('js-yaml');

var defaults = {
  file: '~/.lair/config.yml',
  workspace: '~/.lair',
  extensions: [ 'avi', 'divx', 'idx', 'jpg', 'mkv', 'mp4', 'nfo', 'ogm', 'rm', 'srt', 'ssa', 'sub', 'yml' ]
};

var optionNames = [ 'workspace' ],
    optionNamesWithFile = optionNames.concat([ 'file' ]),
    serverOptionNames = [ 'url', 'token' ];

module.exports = function(options) {

  var config = pick(options, optionNamesWithFile);
  config.server = {};

  if (_.isObject(options.server)) {
    _.each(serverOptionNames, function(name) {
      if (!_.has(config.server, name) && options.server[name]) {
        config.server[name] = options.server[name];
      }
    });
  } else {
    config.server = {};
  }

  _.each(optionNamesWithFile, function(name) {
    var envName = 'LAIR_SCANNER_' + inflection.underscore(name).toUpperCase();
    if (!_.has(config[name]) && process.env[envName]) {
      config[name] = process.env[envName];
    }
  });

  _.each(serverOptionNames, function(name) {
    var envName = 'LAIR_SCANNER_SERVER_' + inflection.underscore(name).toUpperCase();
    if (!_.has(config.server[name]) && process.env[envName]) {
      config.server[name] = process.env[envName];
    }
  });

  var configFile = path.resolve(expand(config.file || defaults.file));
  config.file = configFile;
  config.fileLoaded = false;

  if (fs.existsSync(configFile)) {

    try {
      var contents = yaml.safeLoad(fs.readFileSync(configFile, { encoding: 'utf-8' }));
      _.each(optionNames, function(name) {
        if (!_.has(config, name) && _.has(contents, name)) {
          config[name] = contents[name];
        }
      });

      if (_.isObject(contents.server)) {
        _.each(serverOptionNames, function(name) {
          if (!_.has(config.server, name) && _.has(contents.server, name)) {
            config.server[name] = contents.server[name];
          }
        });
      }

      config.fileLoaded = true;
    } catch (e) {
      config.fileError = e;
    }
  }

  _.defaults(config, defaults);

  config.root = path.resolve(path.join(__dirname, '..'));
  config.workspace = path.resolve(expand(config.workspace));

  config.save = function(file) {

    var configFile = file || config.file,
        contents = yaml.safeDump(_.pick(config, optionNames.concat([ 'server' ])));

    return fs.mkdirsAsync(path.dirname(configFile)).then(function() {
      return fs.writeFileAsync(configFile, contents);
    });
  };

  return p.resolve(config);
};

function pick(source, properties) {
  return _.pick.apply(_, [ source ].concat(properties));
}
