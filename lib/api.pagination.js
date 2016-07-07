var _ = require('lodash');

module.exports = factory;

function factory(res) {
  return new ApiResponsePagination(res);
}

function ApiResponsePagination(res) {
  this.response = res;

  this.start = parseInt(res.headers['x-pagination-start'], 10);
  if (!_.isNumber(this.start)) {
    throw new Error('X-Pagination-Start response header value is not an integer (got ' + res.headers['x-pagination-start'] + ')');
  }

  this.number = parseInt(res.headers['x-pagination-number'], 10);
  if (!_.isNumber(this.number)) {
    throw new Error('X-Pagination-Number response header value is not an integer (got ' + res.headers['x-pagination-number'] + ')');
  }

  this.total = parseInt(res.headers['x-pagination-total'], 10);
  if (!_.isNumber(this.total)) {
    throw new Error('X-Pagination-Total response header value is not an integer (got ' + res.headers['x-pagination-total'] + ')');
  }

  this.filteredTotal = parseInt(res.headers['x-pagination-filtered-total'], 10);
  if (!_.isNumber(this.filteredTotal)) {
    throw new Error('X-Pagination-Filtered-Total response header value is not an integer (got ' + res.headers['x-pagination-filtered-total'] + ')');
  }

  this.hasMoreRecords = this.start + this.number < this.filteredTotal;

  this.numberOfPages = Math.ceil(this.filteredTotal / this.number);
  this.currentPage = Math.floor(this.start / this.number);
}
