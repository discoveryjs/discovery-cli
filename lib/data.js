const assert = require('assert');
const bootstrap = require('./shared/bootstrap');
const { pipeline } = require('./shared/data-pipeline');
const { pathToFileURL } = require('url');

module.exports = bootstrap.model(async function getData(modelConfig, { createPlanEventHandler } = {}) {
    let getData = null;
    let data;

    switch (typeof modelConfig.data) {
        case 'function': {
            getData = modelConfig.data;
            break;
        }

        case 'string': {
            const exports = await import(pathToFileURL(modelConfig.data));

            getData = exports.default;

            assert(
                typeof getData === 'function',
                `Module "${modelConfig.data}" must export a function`
            );
            break;
        }
    }

    // getData can only be a function or null here
    if (getData !== null) {
        getData = pipeline('Retrieving data', getData);

        data = await getData(undefined, createPlanEventHandler?.(getData));
    }

    return data;
});

