var _ = require('underscore'),
    commander = require('commander'),
    errors = require('./errors'),
    p = require('bluebird'),
    pkg = require('../package');

require('./promisify');

var banner = require('./banner'),
    cli = require('./cli'),
    log = require('./log'),
    setup = require('./setup'),
    status = require('./status');

module.exports = function(argv) {

  commander
    .version(pkg.version)
    .option('-c, --config <path>', 'use a custom configuration file (defaults to ~/.lair/config.yml)', '~/.lair/config.yml')
    .option('--trace', 'print detailed message and stack trace when an error occurs');

  commander.parse(argv || process.argv);

  p.resolve(cli.parseOptions(commander))
    .then(banner.print)
    .then(log.newLine)
    .then(setup)
    .then(status)
    .then(log.newLine)
    .catch(errors.logHandler());
};
