var _ = require('underscore'),
    configLoader = require('./config'),
    fs = require('fs'),
    log = require('./log');

module.exports = function(scanner) {

  log.newLine();

  if (!scanner.sources.length) {
    log.muted('You have no media sources defined');
  } else {
    _.each(scanner.sources, function(source) {
      console.log(source.name);
    });
  }
};
