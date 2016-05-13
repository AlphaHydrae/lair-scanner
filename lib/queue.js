var _ = require('underscore'),
    p = require('bluebird');

module.exports = Queue;

function Queue(processor) {
  this.status = 'new';
  this.tasks = [];
  this.results = [];
  this.processor = processor;
}

_.extend(Queue.prototype, {
  add: function(task) {
    this.tasks.push(task);
    this._processNext();
  },

  process: function() {
    if (this.status == 'new') {
      return this._startProcessing();
    } else {
      this._complete();
      return this.promise;
    }
  },

  complete: function() {
    if (this.status == 'completed') {
      return;
    }

    this.status = 'completed';
    this._processNext();
  },

  _processNext: function() {
    if (this._complete()) {
      return;
    }

    var task = this.tasks.unshift(),
        promise = this.processor(task, {
          status: this.status,
          tasksCount: this.tasks.length
        });

    if (promise === false) {
      return;
    }

    promise.then(_.bind(this._handleTaskResolved, this), _.bind(this._handleTaskRejected, this));
  },

  _handleTaskResolved: function(result) {
    this.results.push(result);
    return this._processNext();
  },

  _handleTaskRejected: function(err) {
    this.status = 'errored';
    this.reject();
  },

  _complete: function() {
    if (this.status == 'processing' && !this.tasks.length) {
      this.resolve();
      return true;
    } else {
      return false;
    }
  },

  _startProcessing: function() {

    this.promise = new p(_.bind(function(resolve, reject) {
      this.resolve = resolve;
      this.reject = reject;
    }, this));

    this._processNext();
    this.status = 'processing';

    return this.promise;
  }
});
