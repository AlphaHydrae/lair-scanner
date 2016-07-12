var p = require('bluebird');

p.promisifyAll(require('fs-extra'));
p.promisifyAll(require('tmp'));
