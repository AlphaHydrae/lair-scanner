var _ = require('underscore');

module.exports = {
  parseOptions: function(commander) {
    var optionNames = Array.prototype.slice.call(arguments, 1).concat([ 'config' ]);
    return _.pick.apply(_, [ commander ].concat(optionNames));
  }
};
