const path = require('path');
const cronstrue = require('cronstrue');
const express = require('express');
const cors = require('cors');
const chalk = require('chalk');
const utils = require('./shared/utils');
const bootstrap = require('./shared/bootstrap');
const { createCacheDispatcher } = require('./shared/cache');
const { createProcessEventSource } = require('./shared/process-event-source');
const { createBeforeReady } = require('./serve/before-ready');
const prebuild = require('./serve/prebuild');
const addAssetRoutes = require('./serve/asset-routes');
const modelDataHandler = require('./serve/model-data');
const modelDataStatusHandler = require('./serve/model-data-status');
const modelDownloadHandler = require('./serve/model-download');
const modelResetCacheHandler = require('./serve/model-reset-cache');
const gen = require('./shared/gen');

const ENABLED = chalk.green('enabled');
const DISABLED = chalk.yellow('disabled');

function ensureTrailingSlash(req, res, next) {
    const parsedUrl = new URL(req.originalUrl, 'http://parse');

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

function createModelRouter(modelConfig, options, config, beforeReady, cacheDispatcher) {
    const { slug } = modelConfig;
    const modelCache = cacheDispatcher.getModelCacheInfo(slug);
    const router = express.Router();

    utils.sectionStart(chalk.cyan(slug));
    router.slug = slug;

    if (modelConfig.warnings && modelConfig.warnings.length) {
        for (const msg of modelConfig.warnings) {
            utils.println(chalk.bgYellow.black('WARNING'), msg);
        }
    }

    if (modelConfig.view && modelConfig.view.warnings && modelConfig.view.warnings.length) {
        for (const msg of modelConfig.view.warnings) {
            utils.println(chalk.bgYellow.black('WARNING'), msg);
        }
    }

    if (modelConfig.routers && modelConfig.routers.length) {
        utils.process('Extend with custom routers', () => {
            for (const module of modelConfig.routers) {
                require(module)(router, modelConfig, options);
            }
        });
    }

    utils.process('Define default routes', () => {
        // set up routes
        if (modelConfig.data) {
            const generateDataEvents = createProcessEventSource();

            router.get('/model.data', modelDataHandler(modelConfig, options, cacheDispatcher, generateDataEvents));
            router.get('/data-status', modelDataStatusHandler(generateDataEvents));
        }

        if (modelCache.manualReset) {
            router.get('/drop-cache', modelResetCacheHandler(modelConfig, cacheDispatcher));
        }

        if (options.modelDownload && modelConfig.download) {
            router.get(path.posix.resolve('/', modelConfig.download), modelDownloadHandler(modelConfig, options));
        }

        // assets
        if (options.prebuild) {
            router.use(express.static(
                // FIXME: should prebuild in the root dir when single model mode
                // config.mode === 'single' ? options.prebuild :
                path.join(options.prebuild, slug)
            ));
        } else {
            // favicon
            faviconIfSpecified(router, modelConfig, config);

            // main files
            router.get('/', generate('/model.html', modelConfig, options, config));
            addAssetRoutes(router, 'model', config, options, modelConfig, cacheDispatcher);
        }
    });

    utils.println(`Upload data: ${modelConfig.upload ? ENABLED + (!options.modelDataUpload ? ' (ignored due to options)' : '') : DISABLED}`);
    utils.println(`Embed API: ${modelConfig.embed ? ENABLED : DISABLED}${options.embed !== 'by-config' ? ' (ignored due to --embed option)' : ''}`);
    utils.println(`Custom encodings: ${modelConfig.encodings ? chalk.yellow(modelConfig.encodings) : chalk.gray('<not set>')}`);
    utils.println(`Download: ${modelConfig.download ? chalk.yellow(modelConfig.download) + (!options.modelDownload ? ' (ignored due to options)' : '') : DISABLED}`);
    utils.println(`Color scheme: ${modelConfig.colorScheme !== undefined ? chalk.yellow(JSON.stringify(modelConfig.colorScheme)) : chalk.gray('<not set>')}`);

    if (modelCache.cache && modelConfig.data) {
        utils.sectionStart('Cache:');
        utils.println(`File: ${path.relative(process.cwd(), modelCache.cache)}`);
        utils.println(`TTL: ${typeof modelCache.ttl === 'string'
            ? `${modelCache.ttl} (${cronstrue.toString(modelCache.ttl, { verbose: true, use24HourTimeFormat: true }).replace(/^./, m => m.toLowerCase())})`
            : modelCache.ttl
                ? utils.prettyDuration(modelCache.ttl, true)
                : 'forever'
        }`);
        utils.println(`Background update: ${JSON.stringify(modelCache.bgUpdate)}`);
        utils.println(`Manual reset: ${JSON.stringify(modelCache.manualReset)}`);

        if (options.warmup) {
            utils.process('Warming up', () => {
                beforeReady.add(`Warmup '${slug}' model`, () => cacheDispatcher.warmup(slug));
            });
        }

        utils.sectionEnd();
    } else {
        utils.println('Cache: ' + DISABLED);
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
        utils.println('CORS:', options.cors ? ENABLED : DISABLED);
        utils.section(`Data cache: ${cacheDispatcher.cache ? ENABLED : DISABLED}`, () => {
            if (cacheDispatcher.cache) {
                utils.println('Path:', cacheDispatcher.cachedir);
                utils.println('Temp files path:', cacheDispatcher.tmpdir);
                utils.println('Check TTL:', cacheDispatcher.checkTtl ? ENABLED : DISABLED);
                utils.println('Background updates:', cacheDispatcher.bgUpdate ? ENABLED : DISABLED);
                utils.println('Warmup:', options.warmup ? ENABLED : DISABLED);
                utils.println('Manual reset:', options.modelResetCache ? ENABLED : DISABLED);
            }
        });
        utils.println('Upload data:', options.modelDataUpload ? ENABLED : DISABLED);
        utils.println('Download:', options.modelDownload ? ENABLED : DISABLED);
        utils.println('Embed API:', options.embed === 'enable' ? ENABLED : options.embed === 'disable' ? DISABLED : chalk.yellow(options.embed));
        utils.println('Color scheme:', chalk.yellow(JSON.stringify(config.colorScheme)));
        utils.println('Mode:', chalk.yellow(config.mode));
    });

    // CORS
    if (options.cors) {
        app.use(cors());
    }

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
        console.error(options.model
            ? `  Model \`${options.model}\` is not found` // looks like a user mistake
            : 'No models found');
        process.exit(2);
    } else if (config.mode === 'modelfree') {
        // model free mode
        utils.println('  Models are not defined (model free mode is enabled)');
        utils.silent(() =>
            app.use(createModelRouter(config.models[0], options, config, beforeReady, cacheDispatcher))
        );
    } else {
        const routers = utils.section(
            config.mode === 'single' ? 'Init single model' : 'Init models',
            () => utils.sortModels(config.models).map(modelConfig =>
                createModelRouter(modelConfig, options, config, beforeReady, cacheDispatcher)
            )
        );

        for (const router of routers) {
            app.use('/' + router.slug, ensureTrailingSlash, router);
        }

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
                addAssetRoutes(app, 'index', config, options, null, cacheDispatcher);
            }
        });
    }

    // special routes
    require('./serve/healthz')(app);
    require('./serve/cachez')(app, beforeReady, cacheDispatcher);
    require('./serve/readyz')(app, beforeReady);
    require('./serve/modelz')(app, config);

    if (options.prebuild) {
        beforeReady.add('Prebuild static', () =>
            prebuild(options, config, configFile), true
        );
    }

    if (options.cache) {
        beforeReady.add('Start data cache sync and background updates', () => {
            cacheDispatcher.startBgUpdatesAndSync();
        });
    }

    // run startup tasks using a setTimeout() to let microtaks done
    setTimeout(() => beforeReady.run(), 1);

    // return express app without calling listen() method, since it might be used in various ways
    return app;
});
