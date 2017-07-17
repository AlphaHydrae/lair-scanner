const program = require('commander');
const pkg = require('../package');

require('./promisify');

module.exports = function(argv) {

  program
    .version(pkg.version)
    .command('configure [options]', 'Set the configuration')
    .command('ignore [options] [patterns]', 'Add filename patterns to ignore when scanning media files')
    .command('status [options]', 'Print status', { isDefault: true })
    .command('scan [options]', 'Scan all media files')
    .command('source <command> [options]', 'Manage media sources')
    .command('unignore [options] [patterns]', 'Remove filename patterns to ignore when scanning media files');

  program.parse(argv || process.argv);
};
