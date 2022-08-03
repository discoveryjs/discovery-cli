const assert = require('assert');
const bootstrap = require('./shared/bootstrap');
const { pipeline, explainPipeline } = require('./shared/data-pipeline');
const { preparePlan } = require('./shared/data-pipeline-status');

module.exports = bootstrap.model(async function getData(modelConfig, { createPlanEventHandler } = {}) {
    const startTime = Date.now();
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

        let planEventHandler;

        if (typeof createPlanEventHandler === 'function') {
            planEventHandler = createPlanEventHandler(getData);
        } else if (typeof process.send === 'function') {
            planEventHandler = preparePlan(explainPipeline(getData), message =>
                process.send(message)
            );
        }

        data = await getData(undefined, planEventHandler);
    }

    return {
        name: modelConfig.name,
        createdAt: new Date(),
        elapsedTime: Date.now() - startTime,
        data
    };
});

