var chalk = require('chalk'),
    p = require('bluebird');

var l = module.exports = {
  banner: function(message) {
    l.title(message);
  },

  title: function(message) {
    log(chalk.bold(message));
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
  error: logFactory(error, 'warn')
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
