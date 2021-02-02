const bootstrap = require('./shared/bootstrap');

module.exports = bootstrap.model(function getData(modelConfig) {
    const startTime = Date.now();
    let fetchData = null;

    switch (typeof modelConfig.data) {
        case 'function': {
            fetchData = modelConfig.data();
            break;
        }

        case 'string': {
            const dataFunction = require(modelConfig.data);

            if (typeof dataFunction !== 'function') {
                throw new Error(`Module "${modelConfig.data}" must export a function`);
            }

            fetchData = dataFunction();
            break;
        }
    }

    return Promise.resolve(fetchData).then(data => ({
        name: modelConfig.name,
        createdAt: new Date(),
        elapsedTime: Date.now() - startTime,
        data
    }));
});
