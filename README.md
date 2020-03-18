<img align="right" width="128" height="128"
     alt="Discovery.js project logo"
     src="https://user-images.githubusercontent.com/270491/48985803-1563ae80-f11d-11e8-92c0-e07fbf0bcd94.png"/>

# CLI Tools for Discovery.js

[![NPM version](https://img.shields.io/npm/v/@discoveryjs/cli.svg)](https://www.npmjs.com/package/@discoveryjs/cli)
[![Twitter](https://img.shields.io/badge/Twitter-@js_discovery-blue.svg)](https://twitter.com/js_discovery)

CLI tools to serve & build projects based on [Discovery.js](https://github.com/discoveryjs/discovery)

<!-- TOC depthFrom:2 -->

- [Install](#install)
- [Commands](#commands)
    - [discovery (serve)](#discovery-serve)
    - [discovery-build (build)](#discovery-build-build)
- [Modes](#modes)
    - [Model-free](#model-free)
    - [Single model](#single-model)
    - [Multiple models](#multiple-models)
- [Configuration](#configuration)
    - [Model config](#model-config)
    - [Multi-model config](#multi-model-config)
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

        --cache [dir]          Enable data caching and specify path to store cache files (using a
                               working directory if dir is not set)
    -c, --config <filename>    Path to config (JavaScript or JSON file), if not specified then
                               looking for .discoveryrc.js, .discoveryrc.json, .discoveryrc or
                               "discovery" section in package.json in the listed order
        --dev                  Enable developer mode
    -h, --help                 Output usage information
    -m, --model <name>         Specify a model (multi-model mode only)
        --no-warmup            Disable warm up model data cache on server start
    -p, --port <n>             Listening port (default: 8123)
    -v, --version              Output version
```

### discovery-build (build)

```
Usage:

    discovery-build [config] [options]

Options:

        --cleanup                 Delete all files of output path before saving a result to it
    -c, --config <filename>       Path to config (JavaScript or JSON file), if not specified then
                                  looking for .discoveryrc.js, .discoveryrc.json, .discoveryrc or
                                  "discovery" section in package.json in the listed order
    -h, --help                    Output usage information
    -m, --model <name>            Specify a model (multi-model mode only)
    -o, --output <path>           Path for a build result (`build` by default)
        --pretty-data [indent]    Pretty print of data.json
    -s, --single-file             Output a model build as a single file
    -v, --version                 Output version
```

## Modes

Discovery can work in following modes:

* Model-free, when no any model is specified
* Single model
* Multiple models – a batch of models and index page that lists models

### Model-free

This mode has no any predefined configurations. However, you can upload any data by clicking "Load data" button, or drag'n'drop file right into the browser and discover it.

### Single model

Most common If you want only one model, you should start discovery with `--model %modelName%`. In this mode index page will represent your model default page.

### Multiple models

In case you need that discovery powers more than one model at once, your can use multi-model mode. In this mode discovery will show model selection page as index page. Every model will have own route namespace (slug), and you can switch between models and index page at any time.

## Configuration

To configure discovery you should specify one of config files:

* `.discoveryrc.js`
* `.discoveryrc.json`
* `.discoveryrc` (the same as `.discoveryrc.json`)

Or you can add a section in your `package.json` file with `discovery` as a key.

### Model config

Model config may consists of the following fields (all fields are optional):

* `name` – name of model (used in title)
* `data` – function which returns `any|Promise<any>`. Result of this function must be JSON serializable
* `prepare` – path to a script with additional initialization logic (e.g. add cyclic links and relations, extensions for query engine etc)
* `plugins` – list of plugins (paths to `.js` and `.css` files); relative paths or package name and path are supported; concating to parent's plugin list
* `favicon` – path to favicon image; inherits from parent config when not set
* `viewport` – value for `<meta name="viewport">`; inherits from parent config when not set
* `view` – object with following fields:
    * `basedir` – directory to resolve relative path in `assets` and `libs`
    * `libs` – path to libs, where key is a local name available in asset's scope and value is a path to library file or an array of files (`.js` or `.css`)
    * `assets` – array of path to `.js` and `.css` files
    > js files has own scope (as modules) with a reference `discovery` that points to discovery instance
* `extendRouter` – `function(router, modelConfig, options)`
* `cache`
* `cacheTtl`
* `cacheBgUpdate`

Example:

```js
const path = require('path');

module.exports = {
    name: 'Model config',
    data: () => ({ hello: 'world' }),
    prepare: path.join(__dirname, 'path/to/prepare.js'),
    favicon: 'path/to/favicon.png',
    plugins: [
        '@discoveryjs/view-plugin-highcharts',
        '@discoveryjs/view-plugin-highcharts/index.css',
        './relative-path-to-plugin.js'
    ],
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
* `extendRouter` - array with additional router customization settings
* `favicon` – path to favicon image
* `viewport` – value for `<meta name="viewport">`
* `plugins` – a list of plugin files for every model; list is prepending to a list defined in a model
* `cache`

Example:

```js
module.exports = {
    name: 'My cool dashboards',
    models: {
        one: 'path/to/model/config',
        two: { /* model config */ }
    },
    extendRouter: [
        {
            path: 'auth', // Path relative to root
            handler: require('./auth-router') // Express router
        }
    ]
    favicon: 'path/to/favicon.png',
    plugins: [
        '@discoveryjs/view-plugin-highcharts',
        '@discoveryjs/view-plugin-highcharts/index.css',
        './relative-path-to-plugin.js'
    ]
};
```

## License

MIT
