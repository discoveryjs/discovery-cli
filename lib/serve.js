const path = require('path');
const fs = require('fs');
const url = require('url');
const express = require('express');
const resolve = require('resolve');
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
const defaultRoutes = {
    [ROUTE_DATA]: (req, res) => res.send({ name: 'Model free mode' }),
    [ROUTE_RESET_DATA]: (req, res) => res.send(null),
    [ROUTE_SETUP]: generate(ROUTE_SETUP, {}, { name: 'Discovery', mode: 'modelfree' }),
    [ROUTE_MODEL_PREPARE]: generate(ROUTE_MODEL_PREPARE),
    [ROUTE_MODEL_VIEW_JS]: generate(ROUTE_MODEL_VIEW_JS),
    [ROUTE_MODEL_LIBS_JS]: generate(ROUTE_MODEL_LIBS_JS),
    [ROUTE_MODEL_VIEW_CSS]: generate(ROUTE_MODEL_VIEW_CSS),
    [ROUTE_MODEL_LIBS_CSS]: generate(ROUTE_MODEL_LIBS_CSS)
};

const stubApi = new Proxy({}, {
    get: () => function() {
        return this;
    }
});

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

function generateDataJson(modelConfig, options) {
    const { slug } = modelConfig;
    const prefix = `/${slug}/data.json`;
    const cacheEnabled = Boolean(getCacheFilename(modelConfig));
    let request = null;
    let bgUpdateTimer = null;

    function tryCacheBgUpdate() {
        if (cacheEnabled && !bgUpdateTimer && modelConfig.cacheBgUpdate) {
            const udpateOptions = Object.assign({}, options, { rewriteCache: true });

            console.log(`${prefix} Schedule update cache in background in ${modelConfig.cacheBgUpdate} ms`);
            bgUpdateTimer = setTimeout(
                () => {
                    const bgUpdateStartTime = Date.now();

                    console.log(`${prefix} Start background cache update`);
                    gen['/data.json'](modelConfig, udpateOptions)
                        .catch(error => console.error(`${prefix} Cache update in background error: ${error}`))
                        .then(() => {
                            bgUpdateTimer = null;
                            console.log(`${prefix} Background cache update done in ${Date.now() - bgUpdateStartTime}ms`);
                            tryCacheBgUpdate();
                        });
                },
                modelConfig.cacheBgUpdate
            );
        }
    }

    return function getData(req, res) {
        const startTime = Date.now();

        if (!request) {
            request = gen['/data.json'](modelConfig, options);
            request
                .catch(error => console.error(`${prefix} Collect data error: ${error}`))
                .then(() => {
                    request = null;
                    tryCacheBgUpdate();
                });
        }

        return request
            .then(data => {
                res.set('Content-Type', 'application/json');
                res.send(data);
            })
            .catch(error => {
                res.status(500).json({
                    error: error.stack || String(error),
                    data: null
                });
                console.error(`${prefix} error: ${error}`);
            })
            .then(() => {
                console.log(`${prefix} complete in ${Date.now() - startTime}ms`);
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
                console.log(`/${slug}/ Drop cache`);
            } catch (e) {
                console.log(`/${slug}/ Drop cache ERROR: ${e}`);
            }
        }

        res.status(200).send('OK');
    };
}

function createModelRouter(modelConfig, config, options, routes = {}) {
    const { slug } = modelConfig;
    const cacheFilename = getCacheFilename(modelConfig);
    const router = express.Router();

    utils.sectionStart(slug);

    if (typeof modelConfig.extendRouter === 'function') {
        utils.process('Extend router with custom routes', () => {
            modelConfig.extendRouter(router, modelConfig, options);
        });
    }

    utils.process('Define default routes', () => {
        // set up routes
        Object.keys(defaultRoutes).forEach(path =>
            router.get(path, routes[path] || defaultRoutes[path])
        );

        // favicon
        faviconIfSpecified(router, modelConfig, config);

        // index html
        router.get('/', generate('/model-index.html', modelConfig, options, config));
        router.get('/model.js', (req, res) => res.sendFile(path.join(__dirname, 'static/model.js')));
        router.get('/model.css', (req, res) => res.sendFile(path.join(__dirname, 'static/model.css')));
    });

    if (cacheFilename) {
        utils.println(`Cache: ENABLED (${path.relative(process.cwd(), cacheFilename)})`);

        if (modelConfig.cacheBgUpdate) {
            utils.println(`  Update in background every ${modelConfig.cacheBgUpdate}ms`);
        }

        if (options.warmup && ROUTE_DATA in routes) {
            utils.process('Warming up cache', () => {
                routes[ROUTE_DATA](stubApi, stubApi);
            });
        }
    } else {
        utils.println('Cache: DISABLED');
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
    const app = express();

    console.log(configFile
        ? `Load config from ${configFile}`
        : 'No config is used'
    );

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
            app.use(createModelRouter({ name: 'Discovery' }, config, options))
        );
    } else {
        const routers = utils.section(
            config.mode === 'single' ? 'Init single model' : 'Init models',
            () => config.models.map(modelConfig =>
                createModelRouter(modelConfig, config, options, {
                    [ROUTE_DATA]: generateDataJson(modelConfig, options),
                    [ROUTE_RESET_DATA]: dropDataCache(modelConfig),
                    [ROUTE_SETUP]: generate(ROUTE_SETUP, modelConfig, options, config),
                    [ROUTE_MODEL_PREPARE]: generate(ROUTE_MODEL_PREPARE, modelConfig, options),
                    [ROUTE_MODEL_VIEW_JS]: generate(ROUTE_MODEL_VIEW_JS, modelConfig, options),
                    [ROUTE_MODEL_LIBS_JS]: generate(ROUTE_MODEL_LIBS_JS, modelConfig, options),
                    [ROUTE_MODEL_VIEW_CSS]: generate(ROUTE_MODEL_VIEW_CSS, modelConfig, options),
                    [ROUTE_MODEL_LIBS_CSS]: generate(ROUTE_MODEL_LIBS_CSS, modelConfig, options)
                })
            )
        );

        if (config.mode === 'single') {
            app.use(routers[0]);
        } else {
            faviconIfSpecified(app, null, config);
            app.get('/', generate('/index.html', null, options, config));
            config.models.forEach((model, idx) =>
                app.use('/' + model.slug,
                    ensureTrailingSlash,
                    routers[idx]
                )
            );
        }
    }

    // common static files
    utils.process('Init common routes', () => {
        app.use(express.static(path.join(__dirname, 'static')));
        app.use('/dist', express.static(path.join(discoveryDir, 'dist')));
        app.get('/gen/setup.js', generate('/gen/setup.js', null, options, config));
        app.use('/@discoveryjs/discovery', express.static(path.join(discoveryDir, 'src')));

        for (let name in libs) {
            app.get(`/gen/${libs[name].filename}`, function(req, res) {
                res.type('.js');
                res.send(libs[name].source);
            });
        }

        Object.keys(libs).forEach(name =>
            app.use(
                '/node_modules/' + name,
                express.static(path.dirname(resolve.sync(name + '/package.json', { basedir: discoveryDir })))
            )
        );
    });

    const { extendRouter } = config;
    if (extendRouter) {
        utils.process('Init extra routes', () => {
            for (const router of extendRouter) {
                app.use(router.path, router.handler);
            }
        });
    }

    // start server
    app.listen(options.port, function() {
        console.log(`Server listen on http://localhost:${this.address().port}`);
    });
});
