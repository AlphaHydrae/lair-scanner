var _ = require('underscore'),
    commander = require('commander'),
    errors = require('./errors'),
    events = require('events'),
    fs = require('fs-extra'),
    log = require('./log'),
    p = require('bluebird'),
    path = require('path'),
    pkg = require('../package'),
    ProgressBar = require('progress');

require('./promisify');

var cli = require('./cli'),
    log = require('./log'),
    scanner = require('./scanner'),
    setup = require('./setup'),
    status = require('./status');

module.exports = function(argv) {

  commander
    .version(pkg.version)
    .option('-c, --config <path>', 'use a custom configuration file (defaults to ~/.lair/config.yml)', '~/.lair/config.yml')
    .option('--trace', 'print detailed message and stack trace when an error occurs');

  commander
    .command('list [source...]')
    .description('List files in the configured scan paths')
    .action(function(sources) {

      var options = _.extend({
        sources: sources
      }, cli.parseOptions(commander));

      p.resolve(options).then(list);
    });

  commander
    .command('sync [source...]')
    .description('Scan files')
    .action(function(sources) {

      var options = _.extend({
        sources: sources
      }, cli.parseOptions(commander));

      p.resolve(options).then(sync);
    });

  commander.parse(argv || process.argv);

  if (!commander.args.length) {
    p.resolve(cli.parseOptions(commander)).then(sync);
  }

  function list(options) {
    return setup(options).then(function(scanner) {

      var currentSource,
          emitter = new events.EventEmitter();

      emitter.on('readFile', function(path, stats, source) {
        if (source != currentSource) {
          currentSource = source;

          log.newLine();
          log.title('Listing files in source ' + source.name + '...');
          log.newLine();
        }

        log.message(path);
      });

      return p.all(_.map(findSources(scanner, options.sources), function(source) {
        return scanner.listFiles(source, emitter);
      })).then(log.newLine);
    }).catch(errors.logHandler());
  }

  function sync(options) {
    return setup(options).then(function(scanner) {

      var currentSource,
          localProgress,
          uploadProgress,
          emitter = new events.EventEmitter();

      emitter.on('readDir', function(path, stats, filesCount, source, depth) {
        if (depth === 0) {
          localProgress = new ProgressBar('[:bar] :percent :name', {
            total: filesCount * 2,
            width: 50,
            clear: true
          });
        }
      });

      var n = 0;
      emitter.on('readingDir', function(currentPath, stats, source, depth) {
        if (localProgress && depth == 1) {
          localProgress.tick({ name: path.basename(currentPath) });
        }
      });

      emitter.on('processedDir', function(currentPath, stats, source, depth) {
        if (localProgress && depth == 1) {
          localProgress.tick({ name: path.basename(currentPath) });
        }
      });

      emitter.on('processedFile', function(currentPath, stats, source, depth) {
        if (localProgress && depth == 1) {
          localProgress.tick();
          localProgress.tick();
        }
      });

      emitter.on('scannedFiles', function(state) {
        log.title('Uploading data...');

        var filesToUpload = state.newFilesCount + state.deletedFilesCount + state.modifiedFilesCount;

        if (filesToUpload >= 2) {
          uploadProgress = new ProgressBar('[:bar] :percent', {
            total: filesToUpload,
            width: 50,
            clear: true
          });
        }
      });

      emitter.on('uploadedFiles', function(count) {
        if (uploadProgress) {
          _.times(count, function() {
            uploadProgress.tick();
          });
        }
      });

      return p.all(_.map(findSources(scanner, options.sources), function(source) {
        log.newLine();
        log.title('Scanning source ' + source.name + '...');
        return scanner.syncFiles(source, emitter).then(console.log);
      }));
    }).catch(errors.logHandler());
  }

  function findSources(scanner, names) {

    var sources = scanner.findSources(names);
    if (!sources.length) {
      throw new Error('No source found to list');
    }

    return sources;
  }
};
