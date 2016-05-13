var _ = require('lodash'),
    cli = require('./cli'),
    configLoader = require('./config'),
    configureUi = require('./ui.configure'),
    errors = require('./errors'),
    log = require('./log'),
    p = require('bluebird'),
    program = require('commander');

require('./promisify');

module.exports = function(argv) {

  cli.configureProgram(program)
    .option('-u, --server-url <url>', 'set the URL to the Lair media center')
    .option('-t, --server-token <token>', 'set the authentication token');

  program.parse(argv || process.argv);

  return p.resolve()
    .then(log.newLine)
    .then(load)
    .spread(configureUi)
    .then(log.newLine)
    .catch(errors.handler());

  function load() {
    return p.all([
      cli.loadConfig(program),
      cli.parseOptions(program, 'serverUrl', 'serverToken', {
        save: true,
        force: true
      })
    ])
  }
};
