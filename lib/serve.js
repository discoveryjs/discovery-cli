const path = require('path');
const url = require('url');
const express = require('express');
const chalk = require('chalk');
const utils = require('./shared/utils');
const bootstrap = require('./shared/bootstrap');
const { createCacheDispatcher } = require('./shared/cache');
const { createBeforeReady } = require('./serve/before-ready');
const prebuild = require('./serve/prebuild');
const addAssetRoutes = require('./serve/asset-routes');
const modelDataHandler = require('./serve/model-data');
const modelDropDataCacheHandler = require('./serve/model-drop-data-cache');
const modelDownloadHandler = require('./serve/model-download');
const gen = require('./shared/gen');

const ENABLED = chalk.green('enabled');
const DISABLED = chalk.yellow('disabled');
const ROUTE_DATA = '/data.json';
const ROUTE_DROP_CACHE = '/drop-cache';
const ROUTE_MODEL_BUILD = '/gen/build.zip';
const defaultRoutes = {
    [ROUTE_DATA]: (req, res) => res.json(null),
    [ROUTE_DROP_CACHE]: (req, res) => res.status(403).send('Feature is disabled for the model'),
    [ROUTE_MODEL_BUILD]: (req, res) => res.status(403).send('Feature is disabled for the model')
};

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

function faviconIfSpecified(router, modelConfig, config) {
    const favicon = (modelConfig ? modelConfig.favicon : null) || config.favicon;

    if (favicon) {
        router.get('/favicon' + path.extname(favicon), (req, res) => res.sendFile(favicon));
    }
}

function createModelRouter(modelConfig, options, config, addBeforeReadyTask, cacheDispatcher, routes = {}) {
    const { slug } = modelConfig;
    const modelCache = cacheDispatcher.getModelCacheInfo(slug);
    const router = express.Router();

    utils.sectionStart(chalk.cyan(slug));
    router.slug = slug;

    if (modelConfig.routers.length) {
        utils.process('Extend with custom routers', () => {
            for (const module of modelConfig.routers) {
                require(module)(router, modelConfig, options);
            }
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
            router.get('/', generate('/model.html', modelConfig, options, config));
            addAssetRoutes(router, 'model', config, options, modelConfig);
        }
    });

    utils.println(`Download: ${modelConfig.download || 'NO'}`);
    utils.println(`Darkmode: ${JSON.stringify(modelConfig.darkmode) || '<not set>'}`);

    if (modelCache.cache && ROUTE_DATA in routes) {
        utils.sectionStart('Cache:');
        utils.println(`File: ${path.relative(process.cwd(), modelCache.cache)}`);

        if (modelCache.bgUpdate) {
            utils.println(`Background update every ${utils.prettyDuration(modelCache.bgUpdate, true)}`);
        }

        if (options.warmup) {
            utils.process('Warming up', () => {
                addBeforeReadyTask(`Model '${slug}'`, () => cacheDispatcher.warmup(slug));
            });
        }

        utils.sectionEnd();
    } else {
        utils.println('Cache: NO');
    }

    utils.sectionEnd();

    return router;
}

module.exports = bootstrap(function createServer(options, config, configFile) {
    const app = express();
    const cacheDispatcher = createCacheDispatcher(config.models || [], { configFile, ...options });
    const beforeReady = createBeforeReady(options);

    // setup banner
    utils.section(configFile
        ? `Load config from ${chalk.yellow(configFile)}`
        : 'No config is used', () => {
        utils.println('CORS:', options.cors ? ENABLED + ' (Access-Control-Allow-Origin: *; Access-Control-Expose-Headers: *)' : DISABLED);
        utils.section(`Data cache: ${cacheDispatcher.cache ? ENABLED : DISABLED}`, () => {
            if (cacheDispatcher.cache) {
                utils.println('Path:', cacheDispatcher.cachedir);
                utils.println('Background updates:', cacheDispatcher.bgUpdate ? ENABLED : DISABLED);
                utils.println('Warmup:', options.warmup ? ENABLED : DISABLED);
                utils.println('User reset:', options.modelResetCache ? ENABLED : DISABLED);
            }
        });
        utils.println('Download:', options.modelDownload ? ENABLED : DISABLED);
        utils.println('Darkmode:', chalk.yellow(JSON.stringify(config.darkmode)));
        utils.println('Mode:', chalk.yellow(config.models && config.models.length ? config.mode + '-model' : 'model-free'));
    });

    // default favicon
    app.get('/favicon.ico', express.static(path.join(__dirname, 'static/favicon.ico')));

    // custom routers
    if (config.routers.length) {
        utils.process('Extend with custom routers', () => {
            for (const module of config.routers) {
                require(module)(app, config, options);
            }
        });
    }

    // process models
    if (!config.models || !config.models.length) {
        if (options.model) {
            // looks like a user mistake
            console.error(`  Model \`${options.model}\` is not found`);
            process.exit(2);
        }

        // model free mode
        utils.println('  Models are not defined (model free mode is enabled)');
        utils.silent(() =>
            app.use(createModelRouter({ name: 'Discovery' }, options, config, beforeReady.add, cacheDispatcher))
        );
    } else {
        const routers = utils.section(
            config.mode === 'single' ? 'Init single model' : 'Init models',
            () => utils.sortModels(config.models).map(modelConfig =>
                createModelRouter(modelConfig, options, config, beforeReady.add, cacheDispatcher, {
                    [ROUTE_DATA]: modelDataHandler(modelConfig, options, cacheDispatcher),
                    [ROUTE_DROP_CACHE]: options.modelResetCache && modelDropDataCacheHandler(modelConfig, cacheDispatcher),
                    [ROUTE_MODEL_BUILD]: options.modelDownload && modelDownloadHandler(modelConfig, options)
                })
            )
        );

        routers.forEach((router) =>
            app.use('/' + router.slug, ensureTrailingSlash, router)
        );

        if (config.mode === 'single') {
            // add router to the root in case of a single model mode
            app.use(routers[0]);
        }
    }

    // index page
    if (config.mode === 'multi') {
        utils.section('Init index page', () => {
            faviconIfSpecified(app, null, config);
            app.get('/', generate('/index.html', null, options, config));

            if (options.prebuild) {
                app.use(express.static(options.prebuild));
            } else {
                addAssetRoutes(app, 'index', config, options, null);
            }
        });
    }

    // special routes
    require('./serve/healthz')(app);
    require('./serve/cachez')(app, beforeReady, cacheDispatcher);
    require('./serve/readyz')(app, beforeReady);

    if (options.prebuild) {
        beforeReady.add('Prebuild static', () =>
            prebuild(options, config, configFile), true
        );
    }

    if (cacheDispatcher.used) {
        beforeReady.add('Start data cache sync and background updates', () =>
            cacheDispatcher.startBgUpdatesAndSync()
        );
    }

    // start server
    app.listen(options.port, function() {
        console.log();
        console.log(`Server listen on ${chalk.green(`http://localhost:${this.address().port}`)}`);
        console.log();

        // Await warmup tasks if any
        // Don't use Promise.all() since we need to count tasks left
        if (beforeReady.tasks.length > 0) {
            utils.logMsg(`Await ${beforeReady.tasks.length} tasks before ready (warmup)`);
            beforeReady.run();
        }
    });
});
