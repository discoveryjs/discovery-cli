/* eslint-env browser */
/* global SINGLE_FILE, MODEL_RESET_CACHE */
import { preloader } from '@discoveryjs/discovery/src/preloader';

export const loadStyle = SINGLE_FILE
    ? url => document.querySelector(`style[type="discovery/style"][src=${JSON.stringify(url)}]`).firstChild.nodeValue
    : url => ({ type: 'link', href: url });

export function load(module, styles, options, dataLoaderOptions) {
    const container = document.body;
    const dataRequestId = String(Math.random()).slice(2, 18).padStart(16, '0');
    const loadData = preloader({
        ...dataLoaderOptions,
        loadDataOptions: { fetch: { headers: {
            'Cache-Control': 'no-cache, no-transform',
            'x-data-request-id': dataRequestId
        } } },
        container
    });

    // status of awating data generation
    awaitingDataStatus(loadData, dataRequestId);

    // main part
    return Promise.all([
        module,
        loadData
    ]).then(([init, { data, context }]) =>
        init({ ...options, styles }, loadData.progressbar, data, context)
    ).then(() => {
        loadData.el.remove();
    }, (e) => {
        const el = document.createElement('pre');
        const discoveryEl = document.querySelector('body > .discovery');

        el.className = 'error';
        el.append(document.createTextNode('[ERROR] ' + e + (e.stack ? '\n\n' + e.stack : '')));

        loadData.progressbar.el.replaceWith(el);
        loadData.progressbar.dispose();
        discoveryEl && discoveryEl.remove();

        if (MODEL_RESET_CACHE && options.cacheReset) {
            const resetBtn = document.createElement('button', 'view-button');

            resetBtn.className = 'view-button';
            resetBtn.innerHTML = 'Reload with no cache';
            resetBtn.onclick = () => fetch('drop-cache').then(() => location.reload());

            el.before(resetBtn);
        }
    });
}

// shows status for a long awaiting data request
function awaitingDataStatus(loadData, dataRequestId) {
    const dataStatusEl = document.createElement('div');
    const dataStatusListenInit = setTimeout(() => {
        if (loadData.progressbar.lastStage !== 'request') {
            return;
        }

        const progressbarOnTiming = loadData.progressbar.onTiming;
        const dataStatusEventSource = new EventSource('data-status?data-request-id=' + dataRequestId);
        let planTreeMap;
        let startTime;

        dataStatusEventSource.addEventListener('open', () => {
            dataStatusEl.classList.remove('init');
        }, { once: true });

        dataStatusEventSource.addEventListener('message', message => {
            try {
                const data = JSON.parse(message.data);

                switch (data.type) {
                    case 'start':
                        startTime = data.timestamp;
                        break;

                    case 'stderr':
                    case 'stdout': {
                        if (!planTreeMap) {
                            const frameEl = document.createElement('div');

                            frameEl.className = data.type;
                            frameEl.append(document.createTextNode(data.chunk));

                            dataStatusEl.lastChild.append(frameEl);
                            dataStatusEl.lastChild.scrollTop = dataStatusEl.lastChild.scrollHeight;
                        }
                        break;
                    }

                    case 'plan': {
                        const planTree = createPlanTree(data.plan.steps);

                        planTreeMap = planTree.map;
                        dataStatusEl.lastChild.innerHTML = '';
                        dataStatusEl.lastChild.appendChild(planTree.el);

                        break;
                    }

                    case 'plan-step-event': {
                        const step = planTreeMap.get(data.stepId);

                        if (step) {
                            console.log(data);
                            switch (data.stepEvent) {
                                case 'start':
                                    step.started = data.timestamp;
                                    step.el.classList.add('started');
                                    break;

                                case 'finish':
                                    step.elapsedTimeEl.textContent = duration(data.timestamp - step.started);
                                    step.started = false;
                                    step.el.classList.remove('started');
                                    step.el.classList.add('finished');
                                    break;
                            }
                        } else {
                            console.warn('Pipeline step not found', data);
                        }

                        break;
                    }

                    default:
                        console.info('Unhandled data status SSE event', data);
                }
            } catch (e) {
                console.error('SSE message parse error', e);
            }
        });

        dataStatusEventSource.addEventListener('server-time', ({ data }) => {
            if (startTime) {
                dataStatusEl.querySelector(':scope > .header > .elapsed-time').textContent =
                    duration(data - startTime, 0);
            }
            if (planTreeMap) {
                for (const { started, elapsedTimeEl } of planTreeMap.values()) {
                    if (started && data - started > 200) {
                        elapsedTimeEl.textContent = duration(data - started, 1);
                    }
                }
            }
        });

        dataStatusEventSource.addEventListener('done', () => {
            dataStatusEventSource.close();
        });

        loadData.progressbar.onTiming = (timing) => {
            progressbarOnTiming(timing);

            if (timing.lastStage !== 'request') {
                dataStatusEl.classList.add('finished');
                dataStatusEventSource.close();
            }
        };
    }, 150);

    dataStatusEl.className = 'data-status init';
    dataStatusEl.innerHTML =
        '<div class="header">Generating data progress: <span class="elapsed-time"></span></div>' +
        '<div class="output"></div>';
    dataStatusEl.firstChild.addEventListener('click', function() {
        dataStatusEl.classList.toggle('collapsed');
    }, true);

    loadData.then(
        () => clearTimeout(dataStatusListenInit),
        () => {
            if (dataStatusEl.classList.contains('init')) {
                return;
            }

            dataStatusEl.classList.add('collapsed', 'uncomplete');
            loadData.progressbar.el.after(dataStatusEl);
        }
    );
    loadData.progressbar.el.append(dataStatusEl);
}

function createPlanTree(steps, level = 0, map = new Map()) {
    const listEl = document.createElement('ul');

    listEl.className = 'plan-step-list';
    listEl.style.setProperty('--level', level);

    for (const step of steps) {
        const stepEl = listEl.appendChild(document.createElement('li'));
        const stepHeaderEl = stepEl.appendChild(document.createElement('div'));
        const stepContentEl = stepEl.appendChild(document.createElement('div'));
        const elapsedTimeEl = document.createElement('span');

        map.set(step.id, { step, el: stepEl, elapsedTimeEl, started: false });

        stepEl.className = 'plan-step collapsed';
        stepHeaderEl.className = 'plan-step__header';
        stepHeaderEl.textContent = step.name || 'Untitled';
        stepHeaderEl.append(elapsedTimeEl);
        stepHeaderEl.addEventListener('click', () => stepEl.classList.toggle('collapsed'));
        stepContentEl.className = 'plan-step__content';
        elapsedTimeEl.className = 'plan-step__elapsed-time';

        if (step.steps) {
            stepEl.append(createPlanTree(step.steps, level + 1, map).el);
        }
    }

    return { el: listEl, map };
}

function duration(value, prec = 1) {
    if (value < 1000) {
        return value + 'ms';
    }

    if (value < 10000) {
        return (value / 1000).toFixed(prec) + 's';
    }

    if (value < 60000) {
        return Math.round(value / 1000) + 's';
    }

    return `${Math.floor(value / 60000)}:${Math.floor(value / 1000) % 60}`;
}
