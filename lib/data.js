const bootstrap = require('./shared/bootstrap');

module.exports = bootstrap.model(function getData(modelConfig) {
    const startTime = Date.now();
    let fetchData = null;

    if (typeof modelConfig.data === 'string') {
        const dataEntrypoint = require.resolve(modelConfig.data);
        const dataFunction = require(dataEntrypoint);

        if (typeof dataFunction === 'function') {
            fetchData = dataFunction();
        }
    }

    return Promise.resolve(fetchData).then(data => ({
        name: modelConfig.name,
        createdAt: new Date(),
        elapsedTime: Date.now() - startTime,
        data
    }));
});
