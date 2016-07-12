var _ = require('lodash'),
    cli = require('./cli'),
    program = require('commander'),
    errors = require('./errors'),
    fs = require('fs-extra'),
    log = require('./log'),
    p = require('bluebird'),
    sourcesUi = require('./ui.sources'),
    ui = require('./ui');

require('./promisify');

module.exports = function(argv) {

  cli.configureProgram(program);

  program
    .option('-d, --dry-run', 'Show changes but not sync them to the server')
    .option('-l, --list', 'Print the full list of changes');

  program.parse(argv || process.argv);

  var options = cli.parseOptions(program, 'dryRun');

  return p.resolve()
    .then(log.newLine)
    .then(setup)
    .then(_.partial(scan, _, options))
    .then(log.newLine)
    .catch(errors.handler());

  function setup() {
    return cli.setup(program);
  }

  function scan(scanner, options) {
    return sourcesUi.scan(scanner, cli.parseOptions(options, 'dryRun', 'list'));
  }
};
