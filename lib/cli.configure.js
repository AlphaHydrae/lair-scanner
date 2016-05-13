var _ = require('underscore'),
    commander = require('commander'),
    configureUi = require('./ui.configure'),
    errors = require('./errors'),
    log = require('./log'),
    p = require('bluebird'),
    path = require('path'),
    pkg = require('../package');

require('./promisify');

var cli = require('./cli'),
    log = require('./log'),
    scanner = require('./scanner');

module.exports = function(argv) {

  commander
    .version(pkg.version)
    .option('-c, --config <path>', 'use a custom configuration file (defaults to ~/.lair/config.yml)', '~/.lair/config.yml')
    .option('--trace', 'print detailed message and stack trace when an error occurs')
    .option('-u, --server-url <url>', 'set the URL to the Lair media center')
    .option('-t, --server-token <token>', 'set the authentication token');

  commander.parse(argv || process.argv);

  return p.resolve().then(function() {

    var options = cli.parseOptions(commander, 'serverUrl', 'serverToken');
    options.save = true;

    options.server = {
      url: options.serverUrl,
      token: options.serverToken
    };

    delete options.serverUrl;
    delete options.serverToken;

    log.newLine();
    return configureUi(options).then(log.newLine);
  }).catch(errors.logHandler());
};
