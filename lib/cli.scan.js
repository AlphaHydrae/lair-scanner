var _ = require('lodash'),
    cli = require('./cli'),
    program = require('commander'),
    errors = require('./errors'),
    events = require('events'),
    fs = require('fs-extra'),
    log = require('./log'),
    p = require('bluebird'),
    path = require('path'),
    pkg = require('../package'),
    ProgressBar = require('progress');

require('./promisify');

module.exports = function(argv) {

  cli.configureProgram(program);

  program
    .option('-d, --dry-run', 'Show changes but not sync them to the server');

  program.parse(argv || process.argv);

  var options = cli.parseOptions(program, 'dryRun');

  return p.resolve()
    .then(log.newLine)
    .then(setup)
    .then(_.partial(sync, _, options))
    .then(log.newLine)
    .catch(errors.handler());

  function setup() {
    return cli.setup(program);
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
    }).catch(errors.handler());
  }

  function sync(scanner, options) {
    return p.all(_.map(scanner.sources, function(source) {
      return scanner.api.mediaFiles.findAll({
        mine: 1,
        sourceId: source.id
      }).then(function(res) {
        console.log(res);
        return res.body;
      });
    }));
  }

  function syncAllSources(scanner, options) {

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
  }

  function findSources(scanner, names) {

    var sources = scanner.findSources(names);
    if (!sources.length) {
      throw new Error('No source found to list');
    }

    return sources;
  }
};
