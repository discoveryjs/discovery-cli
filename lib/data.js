const assert = require('assert');
const bootstrap = require('./shared/bootstrap');
const { pipeline } = require('./shared/data-pipeline');

module.exports = bootstrap.model(async function getData(modelConfig, { createPlanEventHandler } = {}) {
    let getData = null;
    let data;

    switch (typeof modelConfig.data) {
        case 'function': {
            getData = modelConfig.data;
            break;
        }

        case 'string': {
            getData = require(modelConfig.data);

            assert(
                typeof getData === 'function',
                `Module "${modelConfig.data}" must export a function`
            );
            break;
        }
    }

    if (getData !== null) {
        getData = pipeline('Retrieving data', getData);

        data = await getData(undefined, createPlanEventHandler?.(getData));
    }

    return data;
});

