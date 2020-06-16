## next

- Disabled async/await transformations on build

## 1.10.3 (15-06-2020)

- Fixed exceptions when no config found (#49)
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
