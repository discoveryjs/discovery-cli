## next

- Changed server to ensure model root route has a trailing slash (i.e. `/model` will be redirected to `/model/`)
- Improved child process error output in server, now it returns stderr output if any
- Tweaked server log output

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
