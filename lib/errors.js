var hasFlag = require('has-flag'),
    log = require('./log');

var errors = module.exports = {
  log: function(err) {

    if (err.friendlyMessage) {
      log.newLine();
      log.mainError(err.friendlyMessage + ' (run with the --trace option for more details)');
    }

    if (!err.friendlyMessage || process.env.LAIR_SCANNER_TRACE || hasFlag('--trace')) {
      log.newLine();
      log.stackTrace(err);
    }

    log.newLine();
  },

  handler: function() {
    return function(err) {
      errors.log(err);
      return err;
    };
  },

  build: function(message, friendlyMessage) {
    return buildError(message, friendlyMessage || message);
  },

  unexpectedServerResponse: function(friendlyMessage, res, options) {
    options = options || {};

    var message = 'Received unexpected HTTP ' + res.statusCode + ' response from the server';
    message += ' (expected HTTP ' + (options.expected || '2xx') + ')';
    message += ': ' + JSON.stringify(res.body);

    return buildError(message, friendlyMessage);
  }
};

function buildError(message, friendlyMessage) {

  var error = new Error(message);
  error.friendlyMessage = friendlyMessage;

  return error;
}
