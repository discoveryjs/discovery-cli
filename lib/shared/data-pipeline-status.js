exports.preparePlan = function preparePlan(plan, onEventHandler) {
    if (!plan || typeof onEventHandler !== 'function') {
        return;
    }

    const planSteps = linearPlanSteps(plan);
    const startedPlanSteps = new Map();
    let id = 1;

    for (const step of planSteps) {
        step.id = id++;
    }

    onEventHandler({ type: 'plan', plan });

    return function(pipelineNode, event, data) {
        let startedStep = startedPlanSteps.get(pipelineNode);

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
                } else {
                    // console.warn('Step not found for', pipelineNode);
                    return;
                }

                break;

            case 'finish':
                startedPlanSteps.delete(startedStep.id);
                break;
        }

        onEventHandler({
            type: 'plan-step-event',
            stepId: startedStep.id,
            stepEvent: event,
            timestamp: Date.now(),
            data
        });
    };
};

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
