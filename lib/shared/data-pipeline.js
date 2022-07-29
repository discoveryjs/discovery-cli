const assert = require('assert');
const planSymbol = Symbol('plan');

const hasOwnPlanSymbol = Object.hasOwn
    ? fn => Object.hasOwn(fn, planSymbol)
    : fn => Object.getOwnPropertySymbols(fn).includes(planSymbol);
const isPipelineStep = value =>
    typeof value === 'function' &&
    hasOwnPlanSymbol(value) &&
    typeof value[planSymbol] === 'object';

const onEventHandlerMap = new WeakMap();
const noop = () => {};
let markerSeed = 1;

function createPipelineStep(type, name, action, children) {
    const pipelineStepInfo = Object.freeze({
        type,
        name,
        children
    });
    const pipelineStep = async (flowData, markerOrEmitEvent) => {
        const pipelineMarker = onEventHandlerMap.has(markerOrEmitEvent)
            ? markerOrEmitEvent
            : { pipeline: markerSeed };
        const emitEvent = typeof markerOrEmitEvent === 'function'
            ? markerOrEmitEvent
            : onEventHandlerMap.get(pipelineMarker) || noop;

        if (pipelineMarker !== markerOrEmitEvent) {
            onEventHandlerMap.set(pipelineMarker, emitEvent);
        }

        emitEvent(pipelineStep, 'start');

        const nextData = await action(flowData, pipelineMarker);

        emitEvent(pipelineStep, 'finish');

        return nextData;
    };

    Object.defineProperty(pipelineStep, planSymbol, {
        value: pipelineStepInfo
    });

    return pipelineStep;
}

function childrenPipelineStepsFrom(value) {
    const children = value.filter(isPipelineStep);

    if (children.length) {
        return Object.freeze(children);
    }
}

// extend(fn | Record)
// extend(name: string, fn | Record)
// extend(name: string, field | fields[], fn)
function extendInternal(type, a, b, c) {
    let asField = null;
    let fields = '*'; // all fields
    let name;
    let extension; // Record, fn, otherwise or throws
    let children;

    if (typeof a === 'string') {
        // extend(name: string, fn | Record)
        // extend(name: string, field | fields[], fn)
        name = a;
        if (typeof b === 'string') {
            asField = b;
            extension = c;
        } else if (Array.isArray(b)) {
            fields = b;
            extension = c;
        } else {
            // extend(name: string, fn | Record)
            extension = b;
        }
    } else if (Array.isArray(a)) {
        // extend(fields: string[], fn)
        fields = a;
        extension = b;
    } else {
        // extend(fn | Record)
        extension = a;
    }

    if (Array.isArray(fields)) {
        assert(fields.every(field => typeof field === 'string'), 'Every fields value must be a string');

        fields = fields.map(field => {
            const [from, to, ...rest] = field.trim().split(/\s*:\s*/);

            assert(rest.length === 0, 'Only one colon is allowed in field\'s value');

            return [from, to || from];
        });
    }

    if (extension && typeof extension === 'object') {
        assert(fields === '*', 'Using fields with extension as an object is prohibited, use a function as an extension instead');

        // extension = Record
        const entries = Object.entries(extension);

        children = childrenPipelineStepsFrom(Object.values(extension));
        extension = async (flowData, pipelineMarker) => {
            const result = [];

            for (const [field, value] of entries) {
                result.push([field, typeof value === 'function'
                    ? await value(flowData, pipelineMarker)
                    : value
                ]);
            }

            return Object.fromEntries(result);
        };
    } else {
        assert(typeof extension === 'function', 'An extension must be a function or an object');
    }

    return createPipelineStep(type, name, async (flowData, pipelineMarker) => {
        const extensionResult = await extension(flowData, pipelineMarker);
        let extensionData;

        if (fields === '*') {
            extensionData = extensionResult;
        } else {
            extensionData = Object.create(null);

            for (const [from, to] of fields) {
                extensionData[to] = extensionResult[from];
            }
        }

        if (typeof asField === 'string') {
            flowData[asField] = extensionData;
        } else {
            Object.assign(flowData, extensionData);
        }

        return flowData;
    }, children);
}

function extend(a, b, c) {
    return extendInternal('extend', a, b, c);
}

// compute(fn)
// compute(name, fn)
function compute(name, fn) {
    const params = typeof name === 'string'
        ? [name, [], fn]
        : [[], name];

    return extendInternal('compute', ...params);
}

// transform(fn | Record)
// transform(name, fn | Record)
function transform(name, action) {
    let children;

    if (typeof name !== 'string') {
        action = name;
        name = undefined;
    }

    if (action && typeof action === 'object') {
        const entries = Object.entries(action);

        children = childrenPipelineStepsFrom(Object.values(action));
        action = async function(flowData, pipelineMarker) {
            const result = [];

            for (const [field, value] of entries) {
                result.push([field, typeof value === 'function'
                    ? await value(flowData, pipelineMarker)
                    : value
                ]);
            }

            return Object.fromEntries(result);
        };
    } else {
        assert(typeof action === 'function', 'An action must be a function or an object');
    }

    return createPipelineStep('transform', name, action, children);
}

function step(name, action) {
    if (typeof name !== 'string') {
        action = name;
        name = undefined;
    }

    return createPipelineStep('step', name, action);
}

function pipeline(name, ...steps) {
    if (typeof name !== 'string') {
        steps.unshift(name);
        name = undefined;
    }

    assert(
        steps.every(step => typeof step === 'function'),
        'All steps of a pipeline must be a function'
    );

    return createPipelineStep('pipeline', name, async (flowData, pipelineMarker) => {
        for (const step of steps) {
            flowData = await step(flowData, pipelineMarker);
        }

        return flowData;
    }, childrenPipelineStepsFrom(steps));
}

function explainPipeline(value) {
    if (!isPipelineStep(value)) {
        return null;
    }

    const pipelineDescriptor = value[planSymbol];
    const { type, name, children } = pipelineDescriptor;
    const result = {
        type,
        name,
        action: value,
        stepsCount: 0,
        steps: []
    };

    if (pipelineDescriptor.name) {
        result.stepsCount += 1;
    }

    if (Array.isArray(children)) {
        for (const child of children) {
            const childExplain = explainPipeline(child);

            assert(childExplain !== null, 'Child is not a pipeline node');

            result.stepsCount += childExplain.stepsCount;

            if (childExplain.name) {
                const { type, name, action, steps } = childExplain;

                result.steps.push(steps.length
                    ? { type, name, action, steps }
                    : { type, name, action }
                );
            } else {
                result.steps.push(...childExplain.steps);
            }
        }
    }

    return result;
}

module.exports = {
    explainPipeline,
    pipeline: Object.assign(pipeline, {
        step,
        extend,
        compute,
        transform
    })
};
