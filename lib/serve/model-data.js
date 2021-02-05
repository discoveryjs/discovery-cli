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

module.exports = function data(modelConfig, options, cacheDispatcher) {
    return function getData(req, res) {
        const { slug } = modelConfig;
        const startTime = Date.now();

        return cacheDispatcher.read(slug)
            .then(cache => {
                if (!cache) {
                    return responseStream(res, options, gen['/data.json'](modelConfig, options));
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
            .then(() => {
                utils.logSlugMsg(slug, 'Responsed "data.json" in', utils.prettyDuration(Date.now() - startTime));
            });
    };
};
