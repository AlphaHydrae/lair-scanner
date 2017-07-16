'use strict';

const _ = require('lodash');
const BPromise = require('bluebird');
const chalk = require('chalk');
const errors = require('./errors');
const events = require('events');
const fs = require('fs-extra');
const log = require('./log');
const path = require('path');
const ProgressBar = require('progress');
const tmp = require('tmp');
const ui = require('./ui');
const scanPathsUi = require('./ui.scanPaths');
const SourceScan = require('./scanning/source-scan');

module.exports = {
  add: function(scanner, options) {
    options = _.extend({}, options);

    var source,
        data = {
          name: options.name,
          path: options.path
        };

    return BPromise.resolve()
      .then(askForName)
      .then(askForLocalPath)
      .then(checkAndNormalizeLocalPath)
      .then(checkName)
      .then(createSource)
      .then(addScanPath).then(function() {
        return source;
      });

    function askForName(message) {
      if (!data.name) {
        return ui.askFor(message || 'Choose a name for the media source:').then(function(answer) {
          data.name = answer;
        });
      }
    }

    function askForLocalPath() {
      if (!data.path) {
        return ui.askForDir('Enter the path to the directory containing the media files (auto-completion enabled):', '/').then(function(answer) {
          data.path = answer;
        });
      }
    }

    function checkAndNormalizeLocalPath() {
      return fs.statAsync(data.path).catch(function(err) {
        throw new Error(`${data.path} does not exist or is not accessible: ${err.message}`);
      }).then(function(stat) {
        if (!stat.isDirectory()) {
          throw new Error(`${data.path} is not a directory`);
        }

        return `/${data.path.replace(/^\//, '').replace(/\/$/, '')}`;
      });
    }

    function checkName() {

      log.start('Checking media source name...');

      return findMediaSource(scanner, data.name).catch(log.stopErrorHandler()).then(function(existing) {
        if (existing) {
          log.stop('warn', 'taken');

          var name = data.name;
          delete data.name;

          return askForName('The name "' + name + '" is already taken, please choose another one:').then(checkName);
        } else {
          log.stop('success', 'done');
        }
      });
    }

    function createSource() {

      log.start('Creating media source...');

      return scanner.createSource(data).catch(log.stopErrorHandler()).then(function(createdSource) {
        log.stop('success', 'done');
        source = createdSource;
        return source;
      });
    }

    function addScanPath() {
      if (options.scanPath) {
        if (options.scanPath === true) {
          log.message('\nTo scan files, you must add a scan path.');
        }

        return scanPathsUi.create(scanner, source, {
          path: options.scanPath === true ? null : options.scanPath,
          category: options.scanPathCategory
        });
      }
    }
  },

  ignore: function(scanner, options) {
    const logger = scanner.config.logger('ignore');
    return BPromise
      .resolve()
      .then(() => ensureMediaSourceExists(scanner, options.name))
      .then(source => {
        const currentIgnores = source.properties.ignores || [];
        if (_.includes(currentIgnores, options.pattern)) {
          return logger.info(chalk.yellow(`Source ${source.name} is already ignoring ${options.pattern}`));
        }

        return scanner.api.mediaSources.update(source.id, {
          properties: {
            ignores: _.uniq(currentIgnores.concat([ options.pattern ]))
          }
        }).then(logger.info(chalk.green(`Files matching ${options.pattern} will now be ignored when scanning source ${source.name}`)));
      });
  },

  unignore: function(scanner, options) {
    const logger = scanner.config.logger('unignore');
    return BPromise
      .resolve()
      .then(() => ensureMediaSourceExists(scanner, options.name))
      .then(source => {
        const currentIgnores = source.properties.ignores || [];
        if (!_.includes(currentIgnores, options.pattern)) {
          return logger.info(chalk.yellow(`Source ${source.name} does not ignore ${options.pattern}`));
        }

        return scanner.api.mediaSources.update(source.id, {
          properties: {
            ignores: _.without(currentIgnores, options.pattern)
          }
        }).then(logger.info(chalk.green(`Files matching ${options.pattern} will now be scanned in source ${source.name}`)));
      });
  },

  scan: function(scanner, options) {

    let promise = BPromise.resolve();

    if (options.name) {
      promise = promise.then(() => ensureMediaSourceExists(scanner, options.name)).then(source => [ source ]);
    } else {
      promise = promise.then(() => scanner.loadSources());
    }

    return promise.then(sources => {
      _.each(sources, source => {
        if (!source.localPath) {
          throw errors.build(`Source ${source.name} has not been located on this machine`);
        }
      });

      return BPromise.reduce(sources, function(memo, source) {
        return scanSource(scanner, source, options);
      }, null);
    });
  },

  locate: function(scanner, options) {
    return ensureMediaSourceExists(scanner, options.name).then(function(source) {

      var data = {
        path: options.path
      };

      return BPromise.resolve()
        .then(askForPath)
        .then(savePath)
        .then(printPath);

      function askForPath() {
        if (data.path) {
          return fs.statAsync(data.path).then(function(stats) {
            if (!stats.isDirectory()) {
              delete data.path;
              return askForPath();
            } else {
              log.newLine();
            }
          }, function() {
            delete data.path;
            return askForPath();
          });
        }

        log.newLine();

        return ui.askForDir('Enter the path to the directory containing the media files (auto-completion enabled):', '/').then(function(answer) {
          data.path = answer;
        });
      }

      function savePath() {
        return scanner.saveSourceLocalPath(source, data.path);
      }

      function printPath() {
        log.success('New path of source ' + source.name + ' successfully set to ' + source.localPath);
      }
    });
  },

  rename: function(scanner, options) {
    return ensureMediaSourceExists(scanner, options.oldName).then(function(source) {

      log.start('Checking new media source name...');
      return findMediaSource(scanner, options.newName).catch(log.stopErrorHandler()).then(function(existing) {
        if (existing) {
          log.stop('warn', 'taken');
          throw errors.build('The name "' + options.newName + '" is already taken.');
        }

        log.stop('success', 'done');

        log.start('Renaming media source...');
        return scanner.api.mediaSources.update(source.id, {
          name: options.newName
        }).catch(log.stopErrorHandler()).then(function() {
          log.stop('success', 'done');
        });
      });
    });
  },

  nfo: function(scanner, options) {
    return ensureMediaSourceExists(scanner, options.name).then(function(source) {

      var mediaSearchesQuery = {
        completed: 1,
        sourceId: source.id,
        include: 'directories'
      };

      scanner.api.mediaSearches.findAll(mediaSearchesQuery).then(function(searches) {
        if (!searches.length) {
          log.message(chalk.green('No NFO files to download. All is good.'));
          log.newLine();
          return;
        }

        var nfosToApply = [];
        _.each(searches, function(search) {
          _.each(_.filter(search.directories, { sourceId: source.id }), function(directory) {

            var data = {
              directory: path.join(source.localPath, directory.path)
            };

            var scanPath = _.find(source.scanPaths, function(sp) {
              return directory.path.indexOf(sp.path + '/') === 0;
            });

            if (scanPath && scanPath.category == 'movie') {
              data.nfoName = 'movie.nfo';
            } else if (scanPath && _.includes([ 'anime', 'show' ], scanPath.category)) {
              data.nfoName = 'tvshow.nfo';
            } else {
              data.nfoName = 'media.nfo';
            }

            data.file = path.join(data.directory, data.nfoName);
            data.url = search.selectedUrl;

            nfosToApply.push(data);
          });
        });

        log.title(chalk.bold('The following NFO files will be saved:'));
        _.each(nfosToApply, function(nfo) {
          log.item(nfo.file + ' -> ' + chalk.blue(nfo.url));
        });

        log.newLine();
        ui.confirm('Are you sure you want to save these NFO files?').then(function(answer) {
          if (!answer) {
            return log.newLine();
          }

          return BPromise.all(_.map(nfosToApply, createAndMoveNfoIntoPlace)).then(function() {
            log.success('All NFO files saved!');
            log.newLine();
          });
        });
      });
    });
  },

  remove: function(scanner, options) {
    return ensureMediaSourceExists(scanner, options.name).then(function(source) {
      log.start('Deleting media source...');
      return scanner.api.mediaSources.delete(source.id).catch(log.stopErrorHandler()).then(function() {
        log.stop('success', 'done');
      });
    });
  },

  ensureMediaSourceExists: ensureMediaSourceExists
};

function createAndMoveNfoIntoPlace(nfo) {
  return tmp.fileAsync({ prefix: 'lair-scanner-' }).then(function(tmpPath) {
    return fs.writeFileAsync(tmpPath, nfo.url, { encoding: 'utf-8' }).then(function() {
      return fs.moveAsync(tmpPath, nfo.file, {
        clobber: false
      });
    });
  });
}

function ensureMediaSourceExists(scanner, name) {

  log.start('Checking media source...');

  return findMediaSource(scanner, name).then(function(source) {
    if (!source) {
      log.stop('warn', 'not found');
      throw errors.build('You don\'t have a media source named "' + name + '"');
    }

    log.stop('success', 'done');
    return source;
  });
}

function findMediaSource(scanner, name) {
  return scanner.loadSource(name).catch(log.stopErrorHandler());
}

function scanSource(scanner, currentSource, options) {
  return new SourceScan(currentSource, scanner, options).scan();
}
