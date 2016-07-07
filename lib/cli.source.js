var _ = require('lodash'),
    cli = require('./cli'),
    configLoader = require('./config'),
    program = require('commander'),
    errors = require('./errors'),
    events = require('events'),
    fs = require('fs-extra'),
    log = require('./log'),
    p = require('bluebird'),
    sourcesUi = require('./ui.sources');

require('./promisify');

var cli = require('./cli'),
    log = require('./log'),
    scanner = require('./scanner'),
    setup = require('./setup');

module.exports = function(argv) {

  cli.configureProgram(program);

  program
    .command('add [name] [path]')
    .option('--scan-path <path>', 'add a scan path')
    .option('--scan-path-category <category>', 'category of media in the scan path')
    .description('Add a media source')
    .action(function(name, path, options) {
      return perform(_.partial(addSource, _, _.extend(options, {
        name: name,
        path: path
      })));
    });

  program
    .command('scan [name]')
    .description('Scan media sources')
    .option('-d, --dry-run', 'Show changes but not sync them to the server')
    .action(function(name, options) {
      return perform(_.partial(scanSources, _, _.extend(cli.parseOptions(options, 'dryRun'), {
        name: name
      })));
    });

  program
    .command('rename <oldName> <newName>')
    .description('Rename a media source')
    .action(function(oldName, newName) {
      return perform(_.partial(renameSource, _, {
        oldName: oldName,
        newName: newName
      }));
    });

  program
    .command('nfo <name>')
    .description('Download missing NFO files selected from the Lair website')
    .action(function(name) {
      return perform(_.partial(nfoSource, _, {
        name: name
      }));
    });

  program
    .command('remove <name>')
    .description('Remove a media source (and delete all its scanned files)')
    .action(function(name) {
      return perform(_.partial(removeSource, _, {
        name: name
      }));
    });

  program.parse(argv || process.argv);

  function perform(op) {
    return p.resolve()
      .then(log.newLine)
      .then(setup)
      .then(op)
      .then(log.newLine)
      .catch(errors.handler());
  }

  function setup() {
    return cli.setup(program, {
      check: false
    });
  }

  function addSource(scanner, options) {
    return sourcesUi.add(scanner, cli.parseOptions(options, 'name', 'path', 'scanPath', 'scanPathCategory'));
  }

  function renameSource(scanner, options) {
    return sourcesUi.rename(scanner, cli.parseOptions(options, 'oldName', 'newName'));
  }

  function scanSources(scanner, options) {
    return sourcesUi.scan(scanner, cli.parseOptions(options, 'name', 'dryRun'));
  }

  function removeSource(scanner, options) {
    return sourcesUi.remove(scanner, cli.parseOptions(options, 'name'));
  }

  function nfoSource(scanner, options) {
    return sourcesUi.nfo(scanner, cli.parseOptions(options, 'name'));
  }
};
