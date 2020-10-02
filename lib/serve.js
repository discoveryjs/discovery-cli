const path = require('path');
const fs = require('fs');
const url = require('url');
const express = require('express');
const resolve = require('resolve');
const chalk = require('chalk');
const utils = require('./shared/utils');
const bootstrap = require('./shared/bootstrap');
const getCacheFilename = require('./shared/get-cache-filename');
const discoveryDir = require('./shared/discovery-dir');
const libs = require(path.join(discoveryDir, 'libs'));
const gen = require('./shared/gen');

const ROUTE_DATA = '/data.json';
const ROUTE_RESET_DATA = '/drop-cache';
const ROUTE_SETUP = '/gen/setup.js';
const ROUTE_MODEL_PREPARE = '/gen/model-prepare.js';
const ROUTE_MODEL_VIEW_JS = '/gen/model-view.js';
const ROUTE_MODEL_LIBS_JS = '/gen/model-libs.js';
const ROUTE_MODEL_VIEW_CSS = '/gen/model-view.css';
const ROUTE_MODEL_LIBS_CSS = '/gen/model-libs.css';
const ROUTE_MODEL_BUILD = '/gen/build.zip';
const defaultRoutes = {
    [ROUTE_DATA]: (req, res) => res.send({ name: 'Model free mode' }),
    [ROUTE_RESET_DATA]: (req, res) => res.send(null),
    [ROUTE_SETUP]: generate(ROUTE_SETUP, null, {}, { name: 'Discovery', mode: 'modelfree' }, null),
    [ROUTE_MODEL_PREPARE]: generate(ROUTE_MODEL_PREPARE),
    [ROUTE_MODEL_VIEW_JS]: generate(ROUTE_MODEL_VIEW_JS),
    [ROUTE_MODEL_LIBS_JS]: generate(ROUTE_MODEL_LIBS_JS),
    [ROUTE_MODEL_VIEW_CSS]: generate(ROUTE_MODEL_VIEW_CSS),
    [ROUTE_MODEL_LIBS_CSS]: generate(ROUTE_MODEL_LIBS_CSS),
    [ROUTE_MODEL_BUILD]: (req, res) => res.status(400).send(null)
};

const stubApi = new Proxy({}, {
    get: () => function() {
        return this;
    }
});

const serverLog = (...args) => console.log(chalk.grey(utils.time()), ...args);
const serverError = (...args) => console.error(chalk.grey(utils.time()), ...args);
const routeLog = (route, ...args) => serverLog(chalk.cyan(route), ...args);
const routeError = (route, ...args) => serverError(chalk.cyan(route), ...args);

function ensureTrailingSlash(req, res, next) {
    const parsedUrl = url.parse(req.originalUrl);

    if (req.path === '/' &&
        !parsedUrl.pathname.endsWith('/') &&
        ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        res.redirect(301, parsedUrl.pathname + '/' + (parsedUrl.search || ''));
    } else {
        next();
    }
}

function generate(filename, ...args) {
    return (req, res, next) => gen[filename](...args)
        .then(content => {
            res.type(path.extname(filename));
            res.send(content);
        })
        .catch(next);
}

function generateStream(filename, ...args) {
    return (req, res, next) => gen[filename](...args)
        .then(({ stream }) => {
            res.set('Content-Type', 'application/zip');
            return new Promise((resolve, reject) =>
                stream
                    .pipe(res)
                    .on('finish', resolve)
                    .on('error', reject)
            );
        })
        .catch(next);
}

function faviconIfSpecified(router, modelConfig, config) {
    const favicon = (modelConfig ? modelConfig.favicon : null) || config.favicon;

    if (favicon) {
        router.get('/favicon' + path.extname(favicon), (req, res) => res.sendFile(favicon));
    }
}

function generateDataJson(modelConfig, options) {
    const { slug } = modelConfig;
    const prefix = `/${slug}/data.json`;
    const bgCacheEnabled = Boolean(getCacheFilename(modelConfig) && modelConfig.cacheBgUpdate);
    let bgUpdateTimer = null;
    let request = null;

    function tryCacheBgUpdate() {
        if (bgCacheEnabled && !bgUpdateTimer) {
            const updateOptions = {
                ...options,
                background: true,
                rewriteCache: true
            };

            routeLog(prefix, `Schedule update cache in background in ${utils.prettyDuration(modelConfig.cacheBgUpdate, true)}`);
            bgUpdateTimer = setTimeout(
                () => {
                    const bgUpdateStartTime = Date.now();

                    routeLog(prefix, 'Start background cache update');
                    gen['/data.json'](modelConfig, updateOptions)
                        .catch(error => routeError(prefix, `Cache update in background error: ${error}`))
                        .then(() => {
                            bgUpdateTimer = null;
                            routeLog(prefix, `Background cache update done in ${utils.prettyDuration(Date.now() - bgUpdateStartTime)}`);
                            tryCacheBgUpdate();
                        });
                },
                modelConfig.cacheBgUpdate
            );
        }
    }

    function cutPaths(text) {
        const home = process.env.HOME;
        const rx = new RegExp(home.replace(/\[\]\(\)\{\}\.\+\*\?/g, '\\$1'), 'g');

        return home ? text.replace(rx, '~') : text;
    }

    return function getData(_, res) {
        const startTime = Date.now();

        if (res === stubApi) {
            return {
                scheduleBgUpdate: bgCacheEnabled ? tryCacheBgUpdate : null,
                warmupDataCache: () => gen['/data.json'](modelConfig, { ...options, background: true })
            };
        }

        if (!request) {
            request = gen['/data.json'](modelConfig, options);
            request
                .catch(error => routeError(prefix, `Collect data error: ${error}`))
                .then(() => {
                    request = null;
                    tryCacheBgUpdate();
                });
        }

        return request
            .then(({ stream, size, brotli }) => {
                res.set('Content-Type', 'application/json');

                if (brotli) {
                    res.set('Content-Encoding', 'br');
                }

                if (size) {
                    res.set('Content-Length', size);
                }

                return new Promise((resolve, reject) =>
                    stream.pipe(res)
                        .on('finish', resolve)
                        .on('error', reject)
                );
            })
            .catch(error => {
                res.status(500).json({
                    error: cutPaths(String(error.stack || error)),
                    data: null
                });
                routeError(prefix, `[ERROR] ${String(error).split(/\r\n?|\n/)[0]}`);
            })
            .then(() => {
                routeLog(prefix, '[OK] Responsed in', utils.prettyDuration(Date.now() - startTime));
            });
    };
}

function dropDataCache(modelConfig) {
    return (req, res) => {
        const { slug } = modelConfig;
        const cacheFile = getCacheFilename(modelConfig);

        if (cacheFile) {
            try {
                fs.unlinkSync(cacheFile);
                routeLog(`/${slug}/`, 'Drop cache');
            } catch (e) {
                routeLog(`/${slug}/`, `Drop cache ERROR: ${e}`);
            }
        }

        res.status(200).send('OK');
    };
}

function prebuild(options) {
    const args = [];

    if (options.configFile) {
        args.push(options.configFile);
    }

    if (options.model) {
        args.push('--model', options.model);
    }

    args.push('--output', options.prebuild);
    args.push('--no-data');
    // args.push('--cleanup');

    console.log('='.repeat(40));
    console.log(' PREBUILD START: ');
    console.log('='.repeat(40));

    return utils.runScript(path.join(__dirname, '../bin/build'), args)
        .then(() => {
            console.log('='.repeat(40));
            console.log(' PREBUILD END');
            console.log('='.repeat(40));
        });
}

function createModelRouter(modelConfig, options, config, addBeforeReadyTask, addScheduleTask, routes = {}) {
    const { slug } = modelConfig;
    const cacheFilename = getCacheFilename(modelConfig);
    const router = express.Router();

    utils.sectionStart(chalk.cyan(slug));

    if (typeof modelConfig.extendRouter === 'function') {
        utils.process('Extend with custom routes', () => {
            modelConfig.extendRouter(router, modelConfig, options);
        });
    }

    utils.process('Define default routes', () => {
        // set up routes
        Object.keys(defaultRoutes).forEach(path =>
            router.get(path, routes[path] || defaultRoutes[path])
        );

        if (options.prebuild) {
            router.use(express.static(
                config.mode === 'single' ? options.prebuild : path.join(options.prebuild, slug)
            ));
        } else {
            // favicon
            faviconIfSpecified(router, modelConfig, config);

            // main files
            router.get('/', generate('/model-index.html', modelConfig, options, config));
            router.get('/model.js', (_, res) => res.sendFile(path.join(__dirname, 'static/model.js')));
            router.get('/model.css', (_, res) => res.sendFile(path.join(__dirname, 'static/model.css')));
        }
    });

    if (cacheFilename) {
        utils.sectionStart('Cache:');
        utils.println(`File: ${path.relative(process.cwd(), cacheFilename)}`);

        if (modelConfig.cacheBgUpdate) {
            utils.println(`Background update every ${utils.prettyDuration(modelConfig.cacheBgUpdate, true)}`);
        }

        if (options.warmup && ROUTE_DATA in routes) {
            utils.process('Warming up', () => {
                const { warmupDataCache, scheduleBgUpdate } = routes[ROUTE_DATA](stubApi, stubApi);

                addBeforeReadyTask(`Model '${slug}'`, warmupDataCache);

                if (scheduleBgUpdate !== null) {
                    addScheduleTask(scheduleBgUpdate);
                }
            });
        }

        utils.sectionEnd();
    } else {
        utils.println('Cache: NO');
    }

    if (Array.isArray(modelConfig.plugins) && modelConfig.plugins.length) {
        utils.sectionStart('Plugins:');
        modelConfig.plugins.forEach(plugin => utils.println(path.relative(process.cwd(), plugin)));
        utils.sectionEnd();
    } else {
        utils.println('Plugins: NO');
    }

    utils.sectionEnd();

    return router;
}

module.exports = bootstrap(function createServer(options, config, configFile) {
    const scheduleTasks = [];
    const addScheduleTask = fn => scheduleTasks.push(fn);
    const beforeReadyTasks = [];
    const addBeforeReadyTask = (name, fn) => beforeReadyTasks.push({
        name: name || 'Untitled',
        status: 'pending',
        fn
    });
    let beforeReadyTasksDone = 0;
    let beforeReadyStartTime;
    let beforeReadyTimeElapsed;
    const app = express();

    console.log(configFile
        ? `Load config from ${chalk.yellow(configFile)}`
        : 'No config is used'
    );

    if (!options.prebuild) {
        // use random isolation marker to avoid mixing with styles of other builds, e.g. JsonDiscovery browser plugin
        options.isolateStyles = 'discovery-server-isolated-' + (new Date().toISOString().replace(/\D/g, ''));
    }

    // check up models
    if (!config.models || !config.models.length) {
        if (options.model) {
            // looks like a user mistake
            console.error(`  Model \`${options.model}\` is not found`);
            process.exit(2);
        }

        // model free mode
        utils.println('  Models are not defined (model free mode is enabled)');
        utils.silent(() =>
            app.use(createModelRouter({ name: 'Discovery' }, options, config, addBeforeReadyTask, addScheduleTask))
        );
    } else {
        config.models = config.models.map(modelConfig => ({
            ...modelConfig,
            download: options.prebuild ? modelConfig.download : false // disable download for not prebuilded mode
        }));
        const routers = utils.section(
            config.mode === 'single' ? 'Init single model' : 'Init models',
            () => config.models.map(modelConfig =>
                createModelRouter(modelConfig, options, config, addBeforeReadyTask, addScheduleTask,
                    options.prebuild
                        ? {
                            [ROUTE_DATA]: generateDataJson(modelConfig, options),
                            [ROUTE_RESET_DATA]: dropDataCache(modelConfig),
                            [ROUTE_MODEL_BUILD]: generateStream(ROUTE_MODEL_BUILD, modelConfig, options)
                        }
                        : {
                            [ROUTE_DATA]: generateDataJson(modelConfig, options),
                            [ROUTE_RESET_DATA]: dropDataCache(modelConfig),
                            [ROUTE_SETUP]: generate(ROUTE_SETUP, modelConfig, options, config, `.${ROUTE_DATA}`),
                            [ROUTE_MODEL_PREPARE]: generate(ROUTE_MODEL_PREPARE, modelConfig, options),
                            [ROUTE_MODEL_VIEW_JS]: generate(ROUTE_MODEL_VIEW_JS, modelConfig, options),
                            [ROUTE_MODEL_LIBS_JS]: generate(ROUTE_MODEL_LIBS_JS, modelConfig, options),
                            [ROUTE_MODEL_VIEW_CSS]: generate(ROUTE_MODEL_VIEW_CSS, modelConfig, options),
                            [ROUTE_MODEL_LIBS_CSS]: generate(ROUTE_MODEL_LIBS_CSS, modelConfig, options)
                        }
                )
            )
        );

        if (typeof config.extendRouter === 'function') {
            utils.process('Extend with custom routes', () => {
                config.extendRouter(app, config, options);
            });
        }

        if (config.mode === 'single') {
            app.use(routers[0]);
            // add the same routing to slug to compliment multi model mode urls
            app.use('/' + config.models[0].slug, ensureTrailingSlash, routers[0]);
        } else {
            faviconIfSpecified(app, null, config);
            app.get('/', generate('/index.html', null, options, config));
            app.get('/gen/index-view.js', generate('/gen/index-view.js', options, config, null));
            app.get('/gen/index-libs.js', generate('/gen/index-libs.js', options, config, null));
            app.get('/gen/index-view.css', generate('/gen/index-view.css', options, config, null));
            app.get('/gen/index-libs.css', generate('/gen/index-libs.css', options, config, null));

            config.models.forEach((model, idx) =>
                app.use('/' + model.slug, ensureTrailingSlash, routers[idx])
            );
        }
    }

    // common static files
    utils.process('Init common routes', () => {
        if (options.prebuild) {
            app.use(express.static(options.prebuild));
            return;
        }

        app.use(express.static(path.join(__dirname, 'static')));
        app.use('/dist', express.static(path.join(discoveryDir, 'dist')));
        app.get('/gen/setup.js', generate('/gen/setup.js', null, options, config, null));
        app.use('/@discoveryjs/discovery', express.static(path.join(discoveryDir, 'src')));

        for (let [name, lib] of Object.entries(libs)) {
            app.get(`/gen/${lib.filename}`, function(req, res) {
                res.type('.js');
                res.send(lib.source);
            });
            app.use(
                '/node_modules/' + name,
                express.static(
                    lib.path ||
                    // for backward compability (prior discovery beta.39)
                    path.dirname(resolve.sync(name + '/package.json', { basedir: discoveryDir }))
                )
            );
        }
    });

    // special routes
    app.get('/healthz', (_, res) => {
        res.status(200);
        res.send({ status: 'OK' });
    });
    app.get('/readyz', (_, res) => {
        const warmupStatus = {};

        if (beforeReadyTasks.length > 0) {
            warmupStatus.warmup = {
                tasksTotal: beforeReadyTasks.length,
                tasksDone: beforeReadyTasksDone,
                tasks: beforeReadyTasks.map(task => ({
                    ...task,
                    startTime: task.startTime && typeof task.startTime === 'number'
                        ? new Date(task.startTime).toISOString()
                        : task.startTime
                })),
                time: beforeReadyTimeElapsed || Date.now() - beforeReadyStartTime
            };
        }

        if (beforeReadyTasksDone < beforeReadyTasks.length) {
            res.status(500);
            res.send({
                status: `Await ready for ${beforeReadyTasks.length - beforeReadyTasksDone} of ${beforeReadyTasks.length} tasks`,
                ...warmupStatus
            });
        } else {
            res.status(200);
            res.send({
                status: 'Ready',
                ...warmupStatus
            });
        }
    });

    if (options.prebuild) {
        addBeforeReadyTask('Prebuild static', () => prebuild(options, config, configFile));
    }

    if (scheduleTasks.length) {
        addBeforeReadyTask('Schedule data cache background update', () => scheduleTasks.forEach(fn => fn()));
    }

    // start server
    app.listen(options.port, function() {
        console.log();
        console.log(`Server listen on ${chalk.green(`http://localhost:${this.address().port}`)}`);
        console.log();

        // Await warmup tasks if any
        // Don't use Promise.all() since we need to count tasks left
        if (beforeReadyTasks.length > 0) {
            serverLog(`Await ${beforeReadyTasks.length} tasks before ready (warmup)`);
            beforeReadyStartTime = Date.now();
            beforeReadyTasks.reduce(
                (pipeline, task) => pipeline.then(() => serverLog('==== Task:', chalk.yellow(task.name)) || Object.assign(task, {
                    status: 'processing',
                    startTime: Date.now()
                }).fn())
                    .catch(error => {
                        console.error(`Warmup task "${task.name}" error:`, task.error = error);

                        if (options.bail) {
                            console.log('Exit due to --bail option');
                            process.exit(2);
                        }
                    })
                    .finally(() => (beforeReadyTasksDone++, Object.assign(task, {
                        status: task.error ? 'failed' : 'ok',
                        duration: Date.now() - task.startTime
                    }))),
                Promise.resolve()
            ).finally(() => {
                beforeReadyTimeElapsed = Date.now() - beforeReadyStartTime;
                serverLog('Warmup is DONE in', utils.prettyDuration(beforeReadyTimeElapsed));
            });
        }
    });
});
