require('./promisify');

module.exports = require('./scanner');

module.exports.cli = {
  lair: require('./cli.lair'),
  scan: require('./cli.scan'),
  status: require('./cli.status')
};
