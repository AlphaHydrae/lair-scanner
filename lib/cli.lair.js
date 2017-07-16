const program = require('commander');
const pkg = require('../package');

require('./promisify');

module.exports = function(argv) {

  program
    .version(pkg.version)
    .command('configure [options]', 'Set the configuration')
    .command('ignore [options] [patterns]', 'Ignore media files')
    .command('status', 'Print status', { isDefault: true })
    .command('scan [options]', 'Scan all media files')
    .command('source <command> [options]', 'Manage media sources')
    .command('unignore [options] [patterns]', 'Remove patterns to ignore');

  program.parse(argv || process.argv);
};
