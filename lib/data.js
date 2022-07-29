const bootstrap = require('./shared/bootstrap');
const { explainPipeline } = require('./shared/data-pipeline');

module.exports = bootstrap.model(function getData(modelConfig) {
    const startTime = Date.now();
    let fetchDataFn = null;
    let fetchData = null;

    switch (typeof modelConfig.data) {
        case 'function': {
            fetchDataFn = modelConfig.data;
            break;
        }

        case 'string': {
            const dataFunction = require(modelConfig.data);

            if (typeof dataFunction !== 'function') {
                throw new Error(`Module "${modelConfig.data}" must export a function`);
            }

            fetchDataFn = dataFunction;
            break;
        }
    }

    if (fetchDataFn !== null) {
        const plan = explainPipeline(fetchDataFn);
        let eventHandler;

        if (plan !== null) {
            if (typeof process.send === 'function') {
                eventHandler = preparePlan(plan);

                process.send({ type: 'plan', plan });
            }
        }

        fetchData = fetchDataFn(undefined, eventHandler);
    }

    return Promise.resolve(fetchData).then(data => ({
        name: modelConfig.name,
        createdAt: new Date(),
        elapsedTime: Date.now() - startTime,
        data
    }));
});

function preparePlan(plan) {
    const planSteps = linearPlanSteps(plan);
    const startedPlanSteps = new Map();
    let id = 1;

    for (const step of planSteps) {
        step.id = id++;
    }

    return function(pipelineNode, event, data) {
        let startedStep = startedPlanSteps.get(pipelineNode);
        let timestamp;

        if (event !== 'start' && !startedStep) {
            // console.warn(`Pipeline step isn\'t started yet but "${event}" event received for`, pipelineNode);
            return;
        }

        switch (event) {
            case 'start':
                if (startedStep) {
                    console.warn('Step is already started but "start" event received for', pipelineNode);
                    break;
                }

                startedStep = planSteps.find(step => step.action === pipelineNode);

                if (startedStep !== undefined) {
                    startedPlanSteps.set(pipelineNode, startedStep);
                    planSteps.splice(planSteps.indexOf(startedStep), 1);
                    timestamp = Date.now();
                } else {
                    // console.warn('Step not found for', pipelineNode);
                    return;
                }

                break;

            case 'finish':
                startedPlanSteps.delete(startedStep.id);
                timestamp = Date.now();
                break;
        }

        process.send({
            type: 'plan-step-event',
            stepId: startedStep.id,
            stepEvent: event,
            timestamp,
            data
        });
    };
}

function linearPlanSteps(plan) {
    const result = [];

    for (let step of plan.steps) {
        result.push(step);

        if (step.steps) {
            result.push(...linearPlanSteps(step));
        }
    }

    return result;
}
