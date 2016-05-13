var _ = require('lodash');

module.exports = {
  join: function() {

    var url = arguments[0],
        parts = Array.prototype.slice.call(arguments, 1);

    _.each(parts, function(part) {
      url += '/' + part.replace(/^\//, '').replace(/\/$/, '');
    });

    return url.replace(/\/$/, '');
  }
};
