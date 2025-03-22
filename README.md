<img align="right" width="128" height="128"
     alt="Discovery.js project logo"
     src="https://user-images.githubusercontent.com/270491/48985803-1563ae80-f11d-11e8-92c0-e07fbf0bcd94.png"/>

# Tools for Discovery.js

[![NPM version](https://img.shields.io/npm/v/@discoveryjs/cli.svg)](https://www.npmjs.com/package/@discoveryjs/cli)
[![Twitter](https://badgen.net/badge/follow/@js_discovery?icon=twitter)](https://twitter.com/js_discovery)

CLI tools to serve & build projects based on [Discovery.js](https://github.com/discoveryjs/discovery)

<!-- TOC depthfrom:2 -->

- [Install](#install)
- [Commands](#commands)
    - [discovery (serve)](#discovery-serve)
    - [discovery-build (build)](#discovery-build-build)
- [Modes](#modes)
    - [Single model](#single-model)
    - [Multiple models](#multiple-models)
    - [Model-free](#model-free)
- [Configuration](#configuration)
    - [Model config](#model-config)
    - [Multi-model config](#multi-model-config)
    - [Configure view](#configure-view)
- [License](#license)

<!-- /TOC -->

## Install

```
npm install @discoveryjs/cli
```

## Commands

### discovery (serve)

```
Usage:

    discovery [config] [options]

Options:

        --bail                    Exit immediately on first warmup task failure
        --no-bg-update            Disable background data cache updates
        --no-cache                Disable data caching
        --cache-persistent        Use persistent caches system
        --cachedir [dir]          Path to store cache files (using .discoveryjs-cache by default when
                                  [dir] is not set)
        --no-check-cache-ttl      Disable data cache TTL checking before using it
    -c, --config <filename>       Path to config (JavaScript or JSON file), if not specified then looking
                                  for .discoveryrc.js, .discoveryrc.json, .discoveryrc or "discovery"
                                  section in package.json in the listed order
        --cors                    Enable CORS, i.e. allows data fetching for any origin
        --no-dev                  Disable using Discovery.js "src" assets when available (disables
                                  discovery-dev condition)
        --embed [mode]            Specify an embed API: by-config (default), enable (when [mode] omitted)
                                  or disable
        --experimental-jsonxl     Enable experimental binary data encoding (codename JSONXL)
    -h, --help                    Output usage information
        --no-minify               Disable JS and CSS minification
    -m, --model <name>            Specify a model (multi-model mode only)
        --no-model-data-upload    Disable model data upload feature
        --no-model-download       Disable model download feature
        --no-model-reset-cache    Disable model cache reset feature
    -p, --port <n>                Listening port (default: 8123)
        --prebuild [path]         Prebuild model's static in path (path is optional, `build` by default)
        --tmpdir <dir>            Path to directory of temporary cache files which are generating before
                                  committing to cache directory
    -v, --version                 Output version
        --no-warmup               Disable model's data cache warm up on server start
```

To create and launch a server in your script, use `createServer()` method which returns [`express`'s application](https://expressjs.com/en/api.html#app):

```js
const discovery = require('@discoveryjs/cli');
const PORT = 1234;

discovery.createServer({ /* options */ }).listen(PORT, function() {
    console.log(`Server listen on http://localhost:${this.address().port}`);
});
```

### discovery-build (build)

```
Usage:

    discovery-build [config] [options]

Options:

        --asset-names [pattern]         Pattern for file names of the asset files corresponding to each model
        --no-cache                      Disable data caching
        --cachedir [dir]                Path to store cache files (using .discoveryjs-cache by default when [dir]
                                        is not set)
        --check-cache-ttl               Check data cache TTL before using it, option enforces to use actual
                                        (according to TTL) data only
        --clean                         Clean the output directory before emit a build files
    -c, --config <filename>             Path to config (JavaScript or JSON file), if not specified then looking
                                        for .discoveryrc.js, .discoveryrc.json, .discoveryrc or "discovery"
                                        section in package.json in the listed order
        --no-data                       Don't include data into a model build
        --no-data-compression           Disable HTML embedded data compression, when --single-file option is used
        --no-dev                        Disable using Discovery.js "src" assets when available (disables
                                        discovery-dev condition)
        --embed [mode]                  Specify an embed API: by-config (default), enable (when [mode] omitted)
                                        or disable
        --entry-names [pattern]         Pattern for file names of the output HTML files corresponding to each model
        --exclude-model-on-data-fail    Exclude models from the result if their data generation fails, ignoring
                                        the failure instead of halting the build (exit code: 1)
        --experimental-jsonxl           Enable experimental binary data encoding (codename JSONXL)
    -h, --help                          Output usage information
        --no-minify                     Disable JS and CSS minification
    -m, --model <name>                  Specify a model (multi-model mode only)
        --no-model-data-upload          Ignore model data upload feature setup in config
        --model-download                Enable model download feature
        --model-reset-cache             Enable model cache reset feature
    -o, --output <path>                 Path for a build result (`build` by default)
        --pretty-data [indent]          Pretty print of model data if any
        --script-external [pattern]     Mark a file or a package as external to exclude it from script bundle
                                        (see https://esbuild.github.io/api/#external). Use "all" value (without
                                        quotes, a shorthand for "./node_modules/*") to disable all the npm
                                        packages from the bundle
        --script-format [format]        Output format for the script files: esm (default), cjs or both
        --script-names [pattern]        Pattern for file names of the script files corresponding to each model
        --serve-only-assets             Include server only assets into build
    -s, --single-file                   Output a model build as a single HTML file per model
        --single-file-data [side]       Used to specify where to locate data: external (default), inline (default
                                        when --single-file is used), both
        --sourcemap [mode]              Enable source map generation, optional "mode" can be: linked (default,
                                        when [mode] is omitted), external or inline
                                        (see https://esbuild.github.io/api/#sourcemap for detail)
        --tmpdir <dir>                  Path to directory of temporary cache files which are generating before
                                        committing to cache directory
    -v, --version                       Output version
```

## Modes

Discovery CLI allows to define a single or multiple predefined models. A model is a composition of data fetch script, prepare data function and a set of pages, views and other helpers. All parts of the model are optional. CLI commands may work in following modes depending on config (see [Configuration](#configuration)):

* `single` – a single model mode, when no index page involved. Enables when config have no `models` field, or `--model` option is used;
* `multi` – multiple models mode, a set of models and index page that lists models. Enables when config contains `models` field and no `--model` option is used;
* `modlefree` – model free mode, when no any model is specified. Enables when no config is specified

### Single model

This mode uses when you need to serve or to build just a single model. To enable this mode, your config must no contain `models` field or command should be lauched with `--model` option (i.e. `discovery --model model-slug`). In this mode the root route will lead to model's default page.

### Multiple models

In case multiple model should be served by a single service, you may use multi models mode. To activate this mode, the config must contain `models` field, which defines configuration for each model. In this mode discovery will show model selection page as index page. Every model will have its own route namespace (i.e. `slug`), and you can switch between models and index page.

### Model-free

In this mode there is no any predefined models. However, you can upload any data by clicking "Load data" button, or drag'n'drop file right into the browser and discover it. This mode uses when no config file is found.

## Configuration

Configuration files are supported in several formats (only one will be used in the priority listed below):

* `.discoveryrc.js` (JavaScript)
* `.discoveryrc.json` (JSON)
* `.discoveryrc` (the same as `.discoveryrc.json`)
* `discovery` property in `package.json` (JSON)

The config file can be explicitly specified by `--config` option. When the config is not found, `modelfree` mode is using.

### Model config

Model config consists of the following fields (all fields are optional):

* `name` – name of the model (used in title)
* `version` – version of the model, can be used in app header when specified
* `description` – description of the model, can be used in app header when specified
* `icon` – path to icon image of the model, can be used in app header when specified
* `meta` – any data (should be serializable to JSON) that will be available in model's `setup.js`
* `data` – function which returns `any | Promise<any>` or path to a module (CommonJS or ESM) that exports such a function as default. Result of the function is using for a model; must be serializable to JSON (i.e. have no cyclic references for now)
* `encodings` – path to a module that exposes an array of encoding configurations for transforming payload data on loading into JavaScript values. This option has an effect only if supported by Discovery.js (added in version `1.0.0-beta.83`).
* `prepare` – (deprecated, use `setup` instead) path to a module (CommonJS or ESM) with a default export of a function that invokes right after data is loaded but before is used (e.g. add cyclic references and relations in data, mark data objects, add annotations and/or helpers for query engine etc)
* `setup` – path to a module (CommonJS or ESM) with a function which call on model creation after all the extensions are applied
* `favicon` – path to favicon image; inherits from parent config when not set
* `viewport` – value for `<meta name="viewport">`; inherits from parent config when not set
* `darkmode` – setup darkmode feature; inherits from parent config when not set
* `upload` – settings for upload data feature; inherits from parent config when not set
* `embed` – explicitly enable or disable embed feature (default `false`)
* `download` – default value for download feature; inherits from parent config when not set
* `view` – setup model's views (see [Configure view](#configure-view))
* `routers` – an array of paths to modules which exports a function (`function(router, modelConfig, options): void`) that extends model router
* `cache` – enables caching for data
* `cacheTtl` – specify time to live of data cache. When data cache become too old, new data will be generated on next request. Value might be a number (milliseconds) or a string (e.g. `"1m"`, `"1 hour 30 mins"` etc; see [parse-duration](https://www.npmjs.com/package/parse-duration) description for possible values)
* `cacheBgUpdate` – specify a time period from a moment of previous cache was generated to update it. Once new cache is generated, it will be used for upcoming requests. Value might be a number (milliseconds) or a string (e.g. `"1m"`, `"1 hour 30 mins"` etc; see [parse-duration](https://www.npmjs.com/package/parse-duration) description for possible values)

Example:

```js
const path = require('path');

module.exports = {
    name: 'My dashboard',
    data: './path/to/generate-data-script.js',
    encodings: path.join(__dirname, 'path/to/encodings.js'),
    prepare: path.join(__dirname, 'path/to/prepare.js'),
    favicon: './path/to/favicon.png',
    viewport: 'width=device-width, initial-scale=1',
    view: {
        basedir: __dirname,
        assets: [
            './ui/page/default.js',
            './ui/view/model-custom-view.css',
            './ui/view/model-custom-view.js',
            './ui/sidebar.css',
            './ui/sidebar.js'
        ]
    }
};
```

### Multi-model config

Multiple models are combine with a single entry point, a config which defines setup for the index page, models and their base configuration. Config should provide JSON or exports an object with following properties (all are optional):

* `name` - name of discovery instance (used in page title)
* `version` – version for the index page, can be used in app header when specified
* `description` – description for the index page, can be used in app header when specified
* `icon` – path to icon image for the index page
* `models` - object with model configurations, where for each entry the key used as a slug and the value as a config
* `modelBaseConfig` – the same as model's config, using as a base for a model config, i.e. `{ ...modelBaseConfig, ...modelConfig }` will be used
* `encodings` – path to a module that exposes an array of encoding configurations for transforming payload data on loading into JavaScript values. This option has an effect only if supported by Discovery.js (added in version `1.0.0-beta.83`).
* `routers` – an array of paths to modules which exports a function (`function(router, modelConfig, options): void`) that extends app routers
* `favicon` – path to favicon image
* `viewport` – value for `<meta name="viewport">`
* `darkmode` – setup darkmode feature (default `"auto"`)
* `upload` – default value for upload data feature (default `false`)
* `embed` – explicitly enable or disable embed feature (default `false`)
* `download` – default value for download feature (default `true`)
* `view` – setup index page views (see [Configure view](#configure-view))

Example:

```js
module.exports = {
    name: 'Dashboards hub',
    favicon: './path/to/favicon.png',
    models: {
        one: './path/to/model/config',
        two: require('./path/to/model/config'),
        three: { /* model config */ }
    }
};
```

### Configure view

* `basedir` – directory to resolve relative paths
* `assets` – array of paths to `.js`, `.ts` and `.css` files
> js files has own scope (as modules) with a reference `discovery` that points to an `App` instance from `@discoveryjs/discovery`
* `serveOnlyAssets` – the same as `assets`, but such assets are included into a model only when the model is serving with `serve` command, or when the model is built with `--serve-only-assets` option (disabled by default)
* `noscript` – function or path to a module which exports a function to generate content for `<noscript>` tag; the function can take two arguments: `getData` an async function returns data, and `setup` object
* `inspector` – option to disable view inspector (default `true`)
* `router` – option to disable default router (default `true`)
* `bundles` – additional bundles

```js
const path = require('path');

module.exports = {
    ...
    view: {
        basedir: __dirname,
        assets: [
            './ui/page/default.js',
            './ui/view/model-custom-view.css',
            './ui/view/model-custom-view.js',
            './ui/sidebar.css',
            './ui/sidebar.js'
        ],
        bundles: {
            'worker.js': './path/to/entry/point.js',
            'some-styles.css': './path/to/entry/point.css'
        }
    }
};
```

## License

MIT
