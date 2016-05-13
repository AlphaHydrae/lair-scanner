var _ = require('underscore'),
    commander = require('commander'),
    errors = require('./errors'),
    events = require('events'),
    fs = require('fs-extra'),
    log = require('./log'),
    p = require('bluebird'),
    path = require('path'),
    pkg = require('../package'),
    sourcesUi = require('./ui.sources');

require('./promisify');

var cli = require('./cli'),
    log = require('./log'),
    scanner = require('./scanner'),
    setup = require('./setup');

module.exports = function(argv) {

  commander
    .version(pkg.version)
    .option('-c, --config <path>', 'use a custom configuration file (defaults to ~/.lair/config.yml)', '~/.lair/config.yml')
    .option('--trace', 'print detailed message and stack trace when an error occurs');

  commander
    .command('add')
    .option('-n, --source-name <name>', 'name of the media source')
    .option('-p, --source-path <path>', 'local path to the media files')
    .option('--scan-path <path>', 'add a scan path')
    .option('--scan-path-category <category>', 'category of media in the scan path')
    .description('Add a media source')
    .action(function(options) {
      options = _.extend(_.pick(options, 'sourceName', 'sourcePath', 'scanPath', 'scanPathCategory'), cli.parseOptions(commander));
      p.resolve(options).then(add);
    });

  commander.parse(argv || process.argv);

  function add(options) {

    options.name = options.sourceName;
    options.path = options.sourcePath;
    delete options.sourceName;
    delete options.sourcePath;
    options.check = false;

    return setup(options).then(function(scanner) {
      return sourcesUi.create(scanner, _.pick(options, 'name', 'path', 'scanPath', 'scanPathCategory'));
    }).catch(errors.logHandler());
  }
};
