const _ = require('lodash');
const cli = require('./cli');
const configLoader = require('./config');
const program = require('commander');
const errors = require('./errors');
const events = require('events');
const fs = require('fs-extra');
const log = require('./log');
const p = require('bluebird');
const scanPathsUi = require('./ui.scanPaths');
const setup = require('./setup');
const sourcesUi = require('./ui.sources');

require('./promisify');

module.exports = function(argv) {

  cli.configureProgram(program);

  program
    .command('add [name] [path]')
    .option('--scan-path <path>', 'add a scan path')
    .option('--scan-path-category <category>', 'default category of scanned media')
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
    .option('-d, --dry-run', 'show changes but not sync them to the server')
    .option('-l, --list', 'print the full list of changes')
    .action(function(name, options) {
      return perform(_.partial(scanSources, _, _.extend(cli.parseOptions(options, 'dryRun', 'list'), {
        name: name
      })));
    });

  program
    .command('locate <name> [path]')
    .description('Locate a media source on the local file system')
    .action(function(name, path) {
      return perform(_.partial(locateSource, _, {
        name: name,
        path: path
      }));
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

  program
    .command('add-scan-path <source-name> [path] [category]')
    .description('Add a scan path to a media source')
    .action((sourceName, path, category) => perform(scanner => addScanPath(scanner, {
      sourceName: sourceName,
      path: path,
      category: category
    })));

  program
    .command('remove-scan-path <source-name> <path>')
    .description('Remove a scan path from a media source')
    .action((sourceName, path) => perform(scanner => removeScanPath(scanner, {
      sourceName: sourceName,
      path: path
    })));

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

  function locateSource(scanner, options) {
    return sourcesUi.locate(scanner, cli.parseOptions(options, 'name', 'path'));
  }

  function renameSource(scanner, options) {
    return sourcesUi.rename(scanner, cli.parseOptions(options, 'oldName', 'newName'));
  }

  function scanSources(scanner, options) {
    return sourcesUi.scan(scanner, cli.parseOptions(options, 'name', 'dryRun', 'list'));
  }

  function removeSource(scanner, options) {
    return sourcesUi.remove(scanner, cli.parseOptions(options, 'name'));
  }

  function nfoSource(scanner, options) {
    return sourcesUi.nfo(scanner, cli.parseOptions(options, 'name'));
  }

  function addScanPath(scanner, options) {
    return sourcesUi.ensureMediaSourceExists(scanner, options.sourceName).then(source => {
      return scanPathsUi.create(scanner, source, cli.parseOptions(options, 'path', 'category'));
    });
  }

  function removeScanPath(scanner, options) {
    return sourcesUi.ensureMediaSourceExists(scanner, options.sourceName).then(source => {
      return scanPathsUi.remove(scanner, source, options.path);
    });
  }
};
