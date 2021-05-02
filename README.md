<img align="right" width="128" height="128"
     alt="Discovery.js project logo"
     src="https://user-images.githubusercontent.com/270491/48985803-1563ae80-f11d-11e8-92c0-e07fbf0bcd94.png"/>

# CLI Tools for Discovery.js

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
Options:
        --bail                    Exit immediately on first warmup task failure
        --cache-persistent        Use persistent caches system
        --cachedir [dir]          Enable data caching and specify path to store cache files (using a
                                  .discoveryjs-cache directory if not set)
    -c, --config <filename>       Path to config (JavaScript or JSON file), if not specified then looking
                                  for .discoveryrc.js, .discoveryrc.json, .discoveryrc or "discovery"
                                  section in package.json in the listed order
        --cors                    Enable CORS, i.e. allows data fetching for any origin
        --dev                     Enable developer mode
    -h, --help                    Output usage information
    -m, --model <name>            Specify a model (multi-model mode only)
        --no-bg-update            Disable background data cache updates
        --no-cache                Disable data caching
        --no-model-download       Enable model download feature
        --no-model-reset-cache    Enable model cache reset feature
        --no-warmup               Disable model's data cache warm up on server start
    -p, --port <n>                Listening port (default: 8123)
        --prebuild [path]         Prebuild model's static in path (path is optional, `build` by default)
    -v, --version                 Output version
```

### discovery-build (build)

```
Usage:

    discovery-build [config] [options]

Options:

        --cachedir [dir]          Enable data caching and specify path to store cache files (using
                                  .discoveryjs-cache by default when [dir] is not set)
        --cleanup                 Delete all files of output path before saving a result to it
    -c, --config <filename>       Path to config (JavaScript or JSON file), if not specified then looking
                                  for .discoveryrc.js, .discoveryrc.json, .discoveryrc or "discovery"
                                  section in package.json in the listed order
    -h, --help                    Output usage information
    -m, --model <name>            Specify a model (multi-model mode only)
        --model-download          Enable model download feature
        --model-reset-cache       Enable model cache reset feature
        --no-cache                Disable data caching
        --no-data                 Exclude data in build
    -o, --output <path>           Path for a build result (`build` by default)
        --pretty-data [indent]    Pretty print of data.json
    -s, --single-file             Output a model build as a single file
    -v, --version                 Output version
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

Discovery CLI supports configuration files in several formats (only one will be used in the priority listed below):

* `.discoveryrc.js` (JavaScript)
* `.discoveryrc.json` (JSON)
* `.discoveryrc` (the same as `.discoveryrc.json`)
* `discovery` property in `package.json` (JSON)

You may explicitly specify config file by using `--config` option. When no config found, `modelfree` mode is using.

### Model config

Model config consists of the following fields (all fields are optional):

* `name` – name of model (used in title)
* `meta` – any data (should be serializable to JSON) that will be available in model's `setup.js`
* `data` – function which returns `any|Promise<any>` or path to a module that exports such a function. Result of the function is using for a model; must be serializable to JSON (i.e. have no cyclic references for now)
* `prepare` – path to a module with a function right after data is loaded but before is used (e.g. add cyclic references and relations in darta, mark data objects, add annotations and/or helpers for query engine etc)
* `favicon` – path to favicon image; inherits from parent config when not set
* `viewport` – value for `<meta name="viewport">`; inherits from parent config when not set
* `darkmode` – setup darkmode feature; inherits from parent config when not set
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
    data: () => ({ hello: 'world' }),
    prepare: path.join(__dirname, 'path/to/prepare.js'),
    favicon: 'path/to/favicon.png',
    viewport: 'width=device-width, initial-scale=1',
    view: {
        basedir: __dirname,
        assets: [
            'ui/page/default.js',
            'ui/view/model-custom-view.css',
            'ui/view/model-custom-view.js',
            'ui/sidebar.css',
            'ui/sidebar.js'
        ]
    }
};
```

### Multi-model config

Config should provide JSON or exports an object with following properties:

* `name` - name of discovery instance (used in page title)
* `models` - object with model configurations, where for each entry the key used as a slug and the value as a config
* `modelBaseConfig` – the same as model's config, using as a base for a model config
* `routers` – an array of paths to modules which exports a function (`function(router, modelConfig, options): void`) that extends app routers
* `favicon` – path to favicon image
* `viewport` – value for `<meta name="viewport">`
* `darkmode` – setup darkmode feature (default `"auto"`)
* `download` – default value for download feature (default `true`)
* `view` – setup index page views (see [Configure view](#configure-view))

Example:

```js
module.exports = {
    name: 'My cool dashboards',
    favicon: 'path/to/favicon.png',
    models: {
        one: 'path/to/model/config',
        two: require('./path/to/model/config'),
        three: { /* model config */ }
    }
};
```

### Configure view

* `basedir` – directory to resolve relative path in `assets` and `libs`
* `assets` – array of path to `.js` and `.css` files
> js files has own scope (as modules) with a reference `discovery` that points to discovery instance

```js
const path = require('path');

module.exports = {
    ...
    view: {
        basedir: __dirname,
        libs: {
            common: '../path/to/common.js',
            moment: path.resolve(__dirname, '../../../node_modules/moment/min/moment.min.js'),
        },
        assets: [
            'ui/page/default.js',
            'ui/view/model-custom-view.css',
            'ui/view/model-custom-view.js',
            'ui/sidebar.css',
            'ui/sidebar.js'
        ]
    }
};
```

## License

MIT
