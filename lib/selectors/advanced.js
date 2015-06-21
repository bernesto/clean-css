var optimizeProperties = require('../properties/optimizer');

var extractProperties = require('./extractor');
var canReorder = require('./reorderable').canReorder;
var stringifyAll = require('../stringifier/one-time').all;

var removeDuplicates = require('./remove-duplicates');
var mergeAdjacent = require('./merge-adjacent');
var reduceNonAdjacent = require('./reduce-non-adjacent');
var mergeNonAdjacentBySelector = require('./merge-non-adjacent-by-selector');
var mergeNonAdjacentByBody = require('./merge-non-adjacent-by-body');
var restructure = require('./restructure');

function AdvancedOptimizer(options, context) {
  this.options = options;
  this.validator = context.validator;
}

AdvancedOptimizer.prototype.removeDuplicateMediaQueries = function (tokens) {
  var candidates = {};

  for (var i = 0, l = tokens.length; i < l; i++) {
    var token = tokens[i];
    if (token[0] != 'block')
      continue;

    var key = token[1][0] + '%' + stringifyAll(token[2]);
    var candidate = candidates[key];

    if (candidate)
      candidate[2] = [];

    candidates[key] = token;
  }
};

AdvancedOptimizer.prototype.mergeMediaQueries = function (tokens) {
  var candidates = {};
  var reduced = [];

  for (var i = tokens.length - 1; i >= 0; i--) {
    var token = tokens[i];
    if (token[0] != 'block')
      continue;

    var candidate = candidates[token[1][0]];
    if (!candidate) {
      candidate = [];
      candidates[token[1][0]] = candidate;
    }

    candidate.push(i);
  }

  for (var name in candidates) {
    var positions = candidates[name];

    positionLoop:
    for (var j = positions.length - 1; j > 0; j--) {
      var source = tokens[positions[j]];
      var target = tokens[positions[j - 1]];
      var movedProperties = extractProperties(source);

      for (var k = positions[j] + 1; k < positions[j - 1]; k++) {
        var traversedProperties = extractProperties(tokens[k]);

        // moved then traversed as we move @media towards the end
        if (!canReorder(movedProperties, traversedProperties))
          continue positionLoop;
      }

      target[2] = source[2].concat(target[2]);
      source[2] = [];

      reduced.push(target);
    }
  }

  return reduced;
};

AdvancedOptimizer.prototype.removeEmpty = function (tokens) {
  for (var i = 0, l = tokens.length; i < l; i++) {
    var token = tokens[i];
    var isEmpty = false;

    switch (token[0]) {
      case 'selector':
        isEmpty = token[1].length === 0 || token[2].length === 0;
        break;
      case 'block':
        this.removeEmpty(token[2]);
        isEmpty = token[2].length === 0;
    }

    if (isEmpty) {
      tokens.splice(i, 1);
      i--;
      l--;
    }
  }
};

function recursivelyOptimizeProperties(tokens, options, validator) {
  for (var i = 0, l = tokens.length; i < l; i++) {
    var token = tokens[i];

    switch (token[0]) {
      case 'selector':
        optimizeProperties(token[1], token[2], false, true, options, validator);
        break;
      case 'block':
        recursivelyOptimizeProperties(token[2], options, validator);
    }
  }
}

AdvancedOptimizer.prototype.optimize = function (tokens) {
  var self = this;

  function _optimize(tokens, withRestructuring) {
    tokens.forEach(function (token) {
      if (token[0] == 'block') {
        var isKeyframes = /@(-moz-|-o-|-webkit-)?keyframes/.test(token[1][0]);
        _optimize(token[2], !isKeyframes);
      }
    });

    recursivelyOptimizeProperties(tokens, self.options, self.validator);

    removeDuplicates(tokens);
    mergeAdjacent(tokens, self.options, self.validator);
    reduceNonAdjacent(tokens, self.options, self.validator);

    mergeNonAdjacentBySelector(tokens, self.options, self.validator);
    mergeNonAdjacentByBody(tokens, self.options);

    if (self.options.restructuring && withRestructuring) {
      restructure(tokens, self.options);
      mergeAdjacent(tokens, self.options, self.validator);
    }

    if (self.options.mediaMerging) {
      self.removeDuplicateMediaQueries(tokens);
      var reduced = self.mergeMediaQueries(tokens);
      for (var i = reduced.length - 1; i >= 0; i--) {
        _optimize(reduced[i][2]);
      }
    }

    self.removeEmpty(tokens);
  }

  _optimize(tokens, true);
};

module.exports = AdvancedOptimizer;