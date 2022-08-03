const fs = require('fs');
const utils = require('../shared/utils');
const gen = require('../shared/gen');

function responseStream(res, options, info) {
    return Promise.resolve(info).then(({ stream, size, etag }) => {
        res.set('Content-Type', 'application/json');

        if (options.cors) {
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Access-Control-Expose-Headers', '*');
        }

        if (etag) {
            res.set('ETag', etag);
        }

        if (size) {
            res.set('Content-Length', size);
            res.set('X-File-Size', size);
        }

        return new Promise((resolve, reject) =>
            stream
                .on('error', reject)
                .pipe(res)
                .on('finish', resolve)
                .on('error', reject)
        );
    });
}

module.exports = function data(modelConfig, options, cacheDispatcher, generateDataEvents) {
    return function getData(req, res) {
        const { slug } = modelConfig;
        const dataRequestId = req.headers['x-data-request-id'];
        const startTime = Date.now();
        let onScriptRun;

        if (dataRequestId) {
            if (generateDataEvents.has(dataRequestId)) {
                res.status(500).end(`Request with request id "${dataRequestId}" already used`);
                return;
            }

            generateDataEvents.add(dataRequestId);
            onScriptRun = (listenSource) =>
                generateDataEvents.attach(dataRequestId, listenSource);
        }

        return cacheDispatcher.read(slug, onScriptRun)
            .then(cache => {
                if (!cache) {
                    const scriptResult = gen['/data.json'](modelConfig, options);

                    if (typeof onScriptRun === 'function' && typeof scriptResult.listen === 'function') {
                        onScriptRun(scriptResult.listen);
                    }

                    return responseStream(res, options, scriptResult);
                }

                const etag = cache.timestamp && cache.size
                    ? `${cache.timestamp}/${cache.size}`
                    : false;

                if (!etag || etag !== req.headers['if-none-match']) {
                    return responseStream(res, options, {
                        stream: fs.createReadStream(cache.file),
                        size: cache.size,
                        etag
                    });
                }

                res.status(304).end();
            })
            .catch(error => {
                res.status(500).json({
                    error: utils.serializeErrorForClient(String(error.stack || error)),
                    data: null
                });
                utils.logSlugError(slug, 'Response "data.json" error:', error);
            })
            .finally(() => {
                generateDataEvents.delete(dataRequestId);
                utils.logSlugMsg(slug, 'Responsed "data.json" in', utils.prettyDuration(Date.now() - startTime));
            });
    };
};
