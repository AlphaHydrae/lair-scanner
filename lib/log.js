var _ = require('lodash'),
    chalk = require('chalk'),
    p = require('bluebird');

var l = module.exports = {
  banner: function(message) {
    l.title(message);
  },

  title: function(message) {
    log(chalk.bold(message));
  },

  item: function(message) {
    log('- ' + message);
  },

  start: function(message) {
    print(chalk.underline(message) + '...');
  },

  stop: function(type, message) {
    l[type](' ' + message);
  },

  stopErrorHandler: function(type, message) {
    return function(err) {
      l.stop(type || 'error', message || 'error');
      return p.reject(err);
    };
  },

  newLine: function() {
    log();
  },

  message: function(message) {
    log(message);
  },

  stackTrace: function(err) {
    log(chalk.red(err.stack));
  },

  mainError: function(message) {
    log(chalk.bold.red(message));
  },

  muted: function(message) {
    log(chalk.gray(message));
  },

  success: logFactory(success),
  warn: logFactory(warn),
  error: logFactory(error, 'warn'),

  summary: function(data, options) {
    options = _.extend({}, options);

    if (data.added || options.all) {
      l.added(data.added);
    }

    if (data.changed || options.all) {
      l.changed(data.changed);
    }

    if (data.removed || options.all) {
      l.removed(data.removed);
    }

    if (data.identical || options.all) {
      l.identical(data.identical);
    }
  },

  added: function(message) {
    log(chalk.black.bgGreen(message));
  },

  changed: function(message) {
    log(chalk.black.bgYellow(message));
  },

  removed: function(message) {
    log(chalk.white.bgRed(message));
  },

  identical: function(message) {
    log(chalk.white.bgBlue(message));
  }
};

function success(message) {
  return chalk.green(message);
}

function warn(message) {
  return chalk.yellow(message);
}

function error(message) {
  return chalk.red(message);
}

function log(message, type) {
  type = type || 'log';
  console[type](message || '');
}

function logFactory(func, type) {
  return function(message) {
    log(func(message), type);
  };
}

function print(message) {
  process.stdout.write(message);
}
