const fs = require('fs');
const { pipeline } = require('stream/promises');
const utils = require('../shared/utils');
const gen = require('../shared/gen');

function ensureUTCDate(value) {
    value = Date.parse(value);

    return value ? new Date(value).toUTCString() : undefined;
}

function responseStream(res, options, info) {
    return Promise.resolve(info).then(({ stream, size, createdAt, etag }) => {
        res.set('Content-Type', 'application/json');

        if (etag) {
            res.set('ETag', etag);
        }

        if (size) {
            res.set('Content-Length', size);
            res.set('X-File-Size', size);
        }

        if (createdAt = ensureUTCDate(createdAt)) {
            res.set('Last-Modified', createdAt);
            res.set('X-File-Created-At', createdAt);
        }

        return pipeline(stream, res);
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
                    const scriptResult = gen['/model.data'](modelConfig, options);

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
                        createdAt: cache.createdAt,
                        etag
                    });
                }

                res.status(304).end();
            })
            .catch(error => {
                const clientErrorData = {
                    error: utils.serializeErrorForClient(String(error.message)),
                    data: null
                };

                if (!res.headersSent) {
                    res.status(500).json(clientErrorData);
                } else if (!res.closed) {
                    res.end(JSON.stringify(clientErrorData));
                }

                if (!req.aborted) {
                    utils.logSlugError(slug, 'Response "model.data" error:', error);
                }
            })
            .finally(() => {
                generateDataEvents.delete(dataRequestId);
                utils.logSlugMsg(slug, `Responsed${req.aborted ? ' (request aborted)' : ''} "model.data" in`, utils.prettyDuration(Date.now() - startTime));
            });
    };
};
