const path = require('path');

module.exports = function(app, beforeReady, cacheDispatcher) {
    app.get('/cachez', (_, res) => {
        res.status(200);
        res.send({
            cache: cacheDispatcher.cache,
            cachedir: cacheDispatcher.cachedir && path.relative(process.cwd(), cacheDispatcher.cachedir),
            startDate: new Date(beforeReady.startTime + beforeReady.timeElapsed),
            models: cacheDispatcher.stat().map(entry => ({
                ...entry,
                cache: entry.cache && path.relative(process.cwd(), entry.cache)
            })),
            files: cacheDispatcher.cacheFiles().map(entry => ({
                ...entry,
                file: path.relative(process.cwd(), entry.file),
                timestamp: new Date(entry.timestamp)
            }))
        });
    });
};
