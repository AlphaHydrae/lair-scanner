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

  var options = cli.parseOptions(commander);
  options.check = false;

  p.resolve()
    .then(banner.print)
    .then(log.newLine)
    .return(options)
    .then(setup)
    .then(status)
    .catch(errors.logHandler());
};
