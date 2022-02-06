## next

- Added support for CSS source maps
- Added support for `upload` option in model config
- Added `--no-model-data-upload` for `serve` command
- Added `--model-data-upload` for `build` command
- Changed approach to inline styles and data:
    - Use `<style type="discovery/style">` for styles instead of `<template>`
    - Use `<script type="discovery/chunk-data">` for data chunks instead of `<template id="[chunk-id]"><script>`
- Fixed `prepare` wrapper to return modified data (#14)
- Fixed `prepare` wrapper to support a promise as a result
- Fixed server launch in model-free mode
- Fixed crash with "No model is found" when `--no-cache` is using

## 2.0.0-beta.12 (31-03-2021)

- Bumped `esbuild` to 0.11.2 and simplified bundling
- Fixed paths in source maps for models assets to be consistent with others
- Fixed interface disabling on error during loading, due to an invisible layer overlapping error block
- Added dark mode toggle to index page (when dark mode is not disabled)
- Fixed download feature regression that was introduced in a recent release
- Fixed model cache update rescheduling, previously model cache stops to update in background when cache generation has been failure

## 2.0.0-beta.11 (16-03-2021)

- Fixed "no such file or directory" crash in server that occurs when main process is reading caches folder and a child process is moving temporary file at this moment
- Fixed broken source maps
- Fixed build output paths for `modelfree` and `single` modes

## 2.0.0-beta.10 (10-03-2021)

- Added support for `view.bundles`

## 2.0.0-beta.9 (04-03-2021)

- Added `inspector` and `router` options in model's `view` config
- Changed `prepare` modules handling. Now a `prepare` module should export a function instead of calling `discovery.setPrepare()` method and no more `discovery` (a reference to `App` or `Widget` instance) injected into module's scope.
- Added support for a common `prepare` function. When `modelBaseConfig.prepare` is set it invokes for every model, right before model's `prepare` if any.
- Added config change detection on server's asset bundling, it eliminates the need to restart the server on config change to get assets according changes 

## 2.0.0-beta.8 (01-03-2021)

- Fixed bundling failure due to changes on absolute path resolving in [esbuild 0.8.51](https://github.com/evanw/esbuild/releases/tag/v0.8.51)

## 2.0.0-beta.7 (17-02-2021)

- Fixed edge case when `runScript` promise remains unresolved, e.g. on unexpected child process termination. This cause to prevent cache updates
- Reworked style processing for preloader

## 2.0.0-beta.6 (12-02-2021)

- Fixed config processing in model-free mode
- Improved timings info in `/cachez`
- Added `--no-check-cache-ttl` option for server

## 2.0.0-beta.5 (11-02-2021)

- Fixed crash on temporary cache files cleanup and related improvements
- Reworked model data cache settings:
    - `cacheTtl` can take a cron expression as a value
    - `cacheBgUpdate` can take a boolean (enabled or disabled) and `"only"` value. When `"only"` is specified, manual cache reset is not available
    - Background updates are scheduling based on `cacheTtl` setting
- Added `warnings` field on model config normalization, which contain all issues around config if any
- Renamed `--cleanup` build option into `--clean`
- Added `--cache-check-ttl` option for build and archive commands
- Added passing `meta` from model's config to model's context

## 2.0.0-beta.4 (08-02-2021)

- Added `--tmpdir` option to customise a dir for data cache temp files

## 2.0.0-beta.3 (05-02-2021)

- Fixed bundling in `@discoveryjs/discovery` itself

## 2.0.0-beta.2 (05-02-2021)

- Boosted build by using `esbuild` and streaming writing
- Improved and simplified serve
- Improved cache subsystem
- Added `--cors` option for server to disable CORS, i.e. allow data fetching for any origin
- Fixed `darkmode` default value for index page when option is not set up in config
- Fixed selector isolation for rules in `@keyframes`
- TBD

## 1.15.0 (11-11-2020)

- Added `--no-bg-update` option for server
- Fixed issue with broken Custom Properties in CSS

## 1.14.3 (04-11-2020)

- Replaced local patched version of `css-tree` for release version 1.0.0

## 1.14.2 (23-10-2020)

- Fixed missed `darkmodePersistent` option for index page

## 1.14.1 (22-10-2020)

- Fixed resource inlining on CSS build to avoid corruption of external and hash references
- Fixed modelfree mode client side setup

## 1.14.0 (20-10-2020)

- Added default `favicon.ico` to server
- Added support for `darkmode` option in config (for index and model)
- Fixed building to avoid "Download" and "Reload without cache" buttons in built result
- Fixed streaming data to client (not through cache) when data contains async values
- Reworked cache subsystem
    - Added `cache` command
    - Added `/cachez` server route with details about cache
    - Added `ETag` header in server when cache is using (response with 304 when data is not changed)
    - Replaced `--cache` option with `--no-cache` and `--cachedir`
    - Changed `--cachedir` (former `--cache` option) default to `.discoveryjs-cache`
    - Improved background data cache updating
    - Fixed issues with corrupted data responding due to read from a cache that's not fully written or uncomplete because of
    - Introduced cache dispatcher that encapsulates cache related logic
    - Removed cache logic and options from `data` command

## 1.13.1 (06-10-2020)

- Added `x-file-size` header to server's `data.json` response to specify original size of content when size is known

## 1.13.0 (02-10-2020)

- Used `@discoveryjs/json-ext` for JSON stream stringifying instead of custom solution
- Fixed suppression of errors when warming up a model data, which cause to treat the model as successful, despite that it is broken
- Added `--bail` option for server to exit on first warmup task failure
- Fixed model's warming up task to wait until data is written to disk before next warmup task
- Changed server's warming up to schedule data cache background update after all other warmup tasks is finished
- Send `Content-Length` header for `data.json` when available
- Added support for model downloading (enabled by default, to disable use `download: false` in main config or model's config)
- Improved model building when a big JSON data is injecting to build

## 1.12.0 (01-07-2020)

- Added warmup task list with details on `readyz`
- Fixed issue when common router extension doesn't apply in single model mode (i.e. when `--model` option is used)

## 1.11.0 (16-06-2020)

- Added support for humanize durations for cacheTtl and cacheBgUpdate in config, e.g. `5mins` or `1h 30m` (see [parse-duration](https://www.npmjs.com/package/parse-duration) for format support)
- Disabled async/await transformations on build

## 1.10.3 (15-06-2020)

- Fixed exceptions when no config found
- Improved error location in prepare module

## 1.10.2 (18-05-2020)

- Fixed server routing in single mode with `--prebuild` option enabled
- Fixed edge cases with custom properties and empty values when bundling CSS

## 1.10.1 (18-05-2020)

- Fixed regression `The requested module './gen/model-libs.js' does not provide an export named 'plugins'`

## 1.10.0 (18-05-2020)

- Added `extendRouter` setting which provide router customization on application level
- Added `meta` field support in model's config to pass extra setup values
- Added `view` field support in multi mode config (i.e. for index page)

## 1.9.1 (07-05-2020)

- Fixed `/gen/setup.js` loading failure when server in modelfree mode

## 1.9.0 (28-04-2020)

- Added striping off source map references in JavaScript assets to avoid warnings
- Added the same routing to model's slug in single mode as in multi model mode for urls persistence between modes
- Improved server stability on warmup, a crash of warmup task doesn't prevent server starting

## 1.8.3 (27-04-2020)

- Fixed CSS bundling to parse and process value of custom properties as regular properties

## 1.8.2 (24-04-2020)

- Fixed wrong "Converting circular structure to JSON" error when empty object or array is reused in object to stringify

## 1.8.1 (23-04-2020)

- Fixed `--prebuild` option for server to not prebuild when option is not set

## 1.8.0 (22-04-2020)

- Added `--prebuild` option for server
- Improved data passing to model

## 1.7.1 (22-04-2020)

- Fixed cache warmup

## 1.7.0 (22-04-2020)

- Added `healthz` route to check server is alive
- Added `readyz` route to check server warmup is done

## 1.6.2 (21-04-2020)

- Fixed JSON stringifying of streams when stream doesn't push `null` on end
- Improved performance and memory consumption of JSON stringifying

## 1.6.1 (17-04-2020)

- Server adds random style isolation marker to avoid mixing with style of other builds, e.g. JsonDiscovery browser plugin
- Fixed JSON stringifying of streams in object mode
- Added output in console about cache file writing time

## 1.6.0 (03-04-2020)

- Reworked data fetching to use streams between processes
- Added support for Promise and Readable streams as values in generated data
- Fixed libs asset generation in ES5 mode to parity ES6 mode

## 1.5.0 (25-03-2020)

- Changed server to ensure model root route has a trailing slash (i.e. `/model` will be redirected to `/model/`)
- Improved child process error output in server, now it returns stderr output if any
- Tweaked server log output
- Reworked CSS style isolation
- Added `--isolate-styles` option for builder
- Exposed `bundleCss()` as `build.bundleCss`

## 1.4.1 (17-12-2019)

- Fixed exception on server start in modelfree mode

## 1.4.0 (16-12-2019)

- Added support for `plugins` option in config, a set of paths relative to config file or npm package names (and optional path to a module inside the package)

## 1.3.0 (13-12-2019)

- Added support for new dist filenames in `@discoveryjs/discovery` (i.e. `dist/discovery.*`)
- Fixed modelfree build in single file mode, when no `data.json` file is available
- Added CSS isolation feature

## 1.2.0 (31-10-2019)

- Exposed index module with command handlers
- Fixed resolving of path to `@discoveryjs/discovery`

## 1.1.1 (16-09-2019)

- Fixed peer dependency reference (`@discoveryjs/discovery`)

## 1.1.0 (09-09-2019)

- Reduced time of build by excluding libraries from a processing (up to x10)
- Fixed hanging requests on server that occur when response generation error
- Moved some wrapping static (html and related) from `@discoveryjs/discovery`

## 1.0.0 (08-09-2019)

- Initial release (extracted from `@discoveryjs/discovery`)
