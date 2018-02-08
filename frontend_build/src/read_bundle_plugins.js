'use strict';
/**
 * Bundle plugin Python config reader module.
 * @module readBundlePlugins
 */

var readWebpackJson = require('./read_webpack_json');
var logging = require('./logging');
var _ = require('lodash');
var path = require('path');
var mkdirp = require('mkdirp');
var webpack = require('webpack');

var parseBundlePlugin = require('./parse_bundle_plugin');

var coreExternals = require('./apiSpecExportTools').coreExternals;

var coreAliases = require('./apiSpecExportTools').coreAliases;

var kolibriName = 'kolibriGlobal';

function setNodePaths(nodePaths) {
  /*
   * This is a filthy hack. Do as I say, not as I do.
   * Taken from: https://gist.github.com/branneman/8048520#6-the-hack
   * This forces the NODE_PATH environment variable to include the main
   * kolibri node_modules folder, so that even plugins being built outside
   * of the kolibri folder will have access to all installed loaders, etc.
   * Doing it here, rather than at command invocation, allows us to do this
   * in a cross platform way, and also to avoid having to prepend it to all
   * our commands that end up invoking webpack.
   */
  nodePaths.forEach(nodePath => {
    var delimiter = process.platform === 'win32' ? ';' : ':';
    process.env.NODE_PATH = process.env.NODE_PATH + delimiter + nodePath;
  });
  require('module').Module._initPaths();
}

/**
 * Take a Python plugin file name as input, and extract the information regarding front end plugin
 * configuration from it using a Python script to import the relevant plugins and then run methods
 * against them to retrieve the config data.
 * @param {string} base_dir - The absolute path of the base directory for writing files to.
 * module names to the global namespace at which those modules can be accessed.
 * @returns {Array} bundles - An array containing webpack config objects.
 */
var readBundlePlugins = function(base_dir) {
  // Takes a module file path and turns it into a Python module path.
  var bundles = [];
  var externals = {};

  var results = readWebpackJson();

  for (var i = 0; i < results.length; i++) {
    var message = results[i];

    var output = parseBundlePlugin(message, base_dir);
    if (typeof output !== 'undefined') {
      bundles.push(output);
    }
  }
  if (bundles.length > 0) {
    for (var k = 0; k < bundles.length; k++) {
      for (var j = 0; j < bundles.length; j++) {
        // We want to prevent the same bundle being built twice, so enforce that here by checking
        // no duplicates.
        if (k !== j) {
          // Only one key per object here, so just get the first key
          if (Object.keys(bundles[k].entry)[0] === Object.keys(bundles[j].entry)[0]) {
            logging.error('Duplicate keys: ' + Object.keys(bundles[k].entry)[0]);
          }
        }
      }
    }
  }

  // A bundle can specify a modification to the coreAPI.
  var coreAPISpec = (
    _.find(bundles, function(bundle) {
      return bundle.coreAPISpec;
    }) || {}
  ).coreAPISpec;

  // Check that there is only one bundle modifying the coreAPI spec.
  if (
    _.filter(bundles, function(bundle) {
      return bundle.coreAPISpec;
    }).length > 1
  ) {
    logging.warn('You have more than one coreAPISpec modification specified.');
  }

  // For that bundle, we replace all references to library modules (like Vue) that we bundle into
  // the core app with references to the core app itself, so if someone does
  // `import Vue from 'vue';` webpack will replace it with a reference to Vue bundled into the
  // core Kolibri app.
  var core_externals = coreExternals();

  bundles.forEach(function(bundle) {
    Object.assign(bundle.resolve.alias, coreAliases(coreAPISpec));
    // Only the default bundle is built for library output to a global variable
    if (bundle.output.library !== kolibriName) {
      // If this is not the core bundle, then we need to add the external library mappings.
      bundle.externals = _.extend({}, externals, core_externals);
    } else {
      bundle.externals = _.extend({ kolibri: bundle.output.library }, externals);
      if (coreAPISpec) {
        bundle.plugins.push(
          new webpack.ProvidePlugin({
            __coreAPISpec: coreAPISpec,
          })
        );
      } else {
        bundle.plugins.push(
          new webpack.DefinePlugin({
            __coreAPISpec: '{}',
          })
        );
      }
    }
  });

  var locale_dir = path.join(base_dir, 'kolibri', 'locale');

  mkdirp.sync(locale_dir);

  var nodePaths = [];

  // We add some custom configuration options to the bundles that webpack 2 dislikes, clean them
  // up here.
  bundles.forEach(function(bundle) {
    delete bundle.coreAPISpec;
    if (bundle.nodePaths) {
      if (!Array.isArray(bundle.nodePaths)) {
        nodePaths.push(bundle.nodePaths);
      } else {
        nodePaths = nodePaths.concat(bundle.nodePaths);
      }
    }
    delete bundle.nodePaths;
  });

  // Allow individual plugins to set extra node paths - this is potentially dangerous,
  // because different node modules might have the same module in them, and we can't
  // predict which one will get resolved first. Caveat emptor.
  setNodePaths(nodePaths);

  return bundles;
};

module.exports = readBundlePlugins;
