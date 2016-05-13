var commander = require('commander'),
    pkg = require('../package');

module.exports = function(argv) {
  commander
    .version(pkg.version)
    .command('configure', 'Set the configuration')
    .command('status', 'Print status', { isDefault: true })
    .command('scan', 'Scan all media files')
    .command('source <command>', 'Manage media sources')
    .parse(argv || process.argv);
};
