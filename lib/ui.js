var _ = require('underscore'),
    fs = require('fs-extra'),
    p = require('bluebird'),
    path = require('path'),
    readline = require('readline');

var ui = module.exports = {
  confirm: function(query) {
    return p.resolve(query + ' (y/n)').then(ui.askFor).then(function(answer) {
      return answer.match(/^(?:1|y|yes|t|true)$/i);
    });
  },

  askFor: function(query) {
    return question(query + ' ');
  },

  askForDir: function(query, basePath) {
    return ui.askForPath(query, basePath, function(stat) {
      return stat.isDirectory();
    }).then(function(answer) {

      var dir = basePath + answer;

      return fs.statAsync(dir).then(function(stat) {
        if (!stat.isDirectory()) {
          return ui.askForDir(dir + ' is not a directory, please enter a valid directory:', basePath);
        }

        return dir;
      }, function(err) {
        return ui.askForDir(dir + ' could not be found, please enter a valid directory:', basePath);
      });
    });
  },

  askForPath: function(query, basePath, statFilter) {
    return question(query + ' ' + (basePath || ''), { completer: fsCompleter }).then(function(answer) {
      return answer.replace(/\/$/, '');
    });

    function fsCompleter(partial, callback) {

      var partialPath = basePath + (partial || ''),
          dir = partialPath.match(/\/$/) ? partialPath.replace(/\/$/, '') : path.dirname(partialPath),
          substring = partialPath.match(/\/$/) ? '' : path.basename(partialPath);

      if (!dir.length) {
        dir = '/';
      }

      if (!fs.existsSync(dir)) {
        return callback(undefined, [ [], substring ]);
      }

      fs.readdirAsync(dir).then(function(files) {

        var matchingFiles = _.filter(files.sort(), function(file) {
          return file.indexOf(substring) === 0;
        });

        p.settle(_.map(matchingFiles, function(file) {
          return fs.lstatAsync(path.join(dir, file)).then(function(stat) {
            if (!statFilter(stat)) {
              return p.reject();
            }

            return stat.isDirectory() ? file + '/' : file;
          });
        })).then(function(results) {

          var completions = _.reduce(results, function(memo, result) {
            if (result.isFulfilled()) {
              memo.push(result.value());
            }

            return memo;
          }, []);

          callback(undefined, [ completions, substring ]);
        });
      }, callback);
    }
  }
};

function question(query, options) {
  options = options || {};

  var riOptions = {
    input: process.stdin,
    output: process.stdout
  };

  if (options.completer) {
    riOptions.completer = options.completer;
  }

  var ri = readline.createInterface(riOptions);

  return new p(function(resolve, reject) {
    ri.question(query, function(answer) {
      resolve(answer);
    });
  }).then(function(answer) {
    ri.close();
    return answer;
  }, function(err) {
    ri.close();
    return p.reject(err);
  });
}
