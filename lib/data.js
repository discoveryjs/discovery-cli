const bootstrap = require('./shared/bootstrap');

module.exports = bootstrap.model(function getData(modelConfig) {
    const startTime = Date.now();
    const fetchData = typeof modelConfig.data === 'function'
        ? modelConfig.data()
        : null;

    return Promise.resolve(fetchData).then(data => ({
        name: modelConfig.name,
        createdAt: new Date(),
        elapsedTime: Date.now() - startTime,
        data
    }));
});
