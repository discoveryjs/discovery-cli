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
    - [Multiple models](#multiple-models)
    - [Single model](#single-model)
- [Configuration](#configuration)
    - [Multi-model config](#multi-model-config)
    - [Model config](#model-config)
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

      --cache [dir]        Enable data caching and specify path for cache files, use working directory when
                           is not set
  -c, --config <filename>  Path to config (JavaScript or JSON file)
      --dev                Enable developer mode
  -h, --help               Output usage information
  -m, --model <name>       Specify a model (multi-model mode only)
      --no-warmup          Disable warm up model data cache on server start
  -p, --port <n>           Listening port (default: 8123)
  -v, --version            Output version
```

### discovery-build (build)

```
Usage:

  discovery-build [config] [options]

Options:

      --cleanup               Delete all files of output path before saving a result to it
  -c, --config <filename>     Path to config (JavaScript or JSON file)
  -h, --help                  Output usage information
  -m, --model <name>          Specify a model (multi-model mode only)
  -o, --output <path>         Path for a build result
      --pretty-data [indent]  Pretty print of data.json
  -s, --single-file           Output a model build as a single file
  -v, --version               Output version
```

## Modes

Discovery can work in following modes:

* Model-free (when no any model specified)
* Single model
* Multiple models

### Model-free

In this mode you can upload any data by clicking "Load data" button, or drag'n'drop file right into the browser.

### Multiple models

In this mode discovery will start with model selection page. Every model will have own route namespace, and you can switch models and reports at any time.

### Single model

If you want only one model, you should start discovery with `--model %modelName%`. In this mode index page will represent your model default page.

## Configuration

To configure discovery you should specify one of config files:

* `.discoveryrc.js`
* `.discoveryrc.json`
* `.discoveryrc` (the same as `.discoveryrc.json`)

Or you can add a section in your `package.json` file with `discovery` as a key.

### Multi-model config

Config should provide JSON or exports an object with following properties:

* `name` - name of discovery instance (used in page title)
* `models` - object with model configurations, where for each entry the key used as a slug and the value as a config

Example:

```js
module.exports = {
    name: 'My cool dashboards',
    models: {
        one: <modelConfig>,
        two: <modelConfig>
    }
};
```

### Model config

Model config may consists of the following fields (all fields are optional):

* `name` – name of model (used in title)
* `data` – function which returns `any|Promise<any>`. Result of this function must be JSON serializable
* `prepare` – path to a script with additional initialization logic (e.g. add cyclic links and relations, extensions for query engine etc)
* `view` – object with following fields:
    * `basedir` – directory to resolve relative path in `assets` and `libs`
    * `libs` – path to libs, where key is local name available in asset's scope and value is a path to library file or an array of files (`.js` or `.css`)
    * `assets` – path to `.js` and `.css` files
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

## License

MIT
