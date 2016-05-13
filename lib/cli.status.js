var _ = require('lodash'),
    banner = require('./banner'),
    cli = require('./cli'),
    configLoader = require('./config'),
    errors = require('./errors'),
    log = require('./log'),
    p = require('bluebird'),
    program = require('commander'),
    status = require('./status');

require('./promisify');

module.exports = function(argv) {

  cli.configureProgram(program);

  program.parse(argv || process.argv);

  return p.resolve()
    .then(banner.print)
    .then(log.newLine)
    .then(setup)
    .then(status)
    .catch(errors.handler());

  function setup() {
    return cli.setup(program);
  }
};
