/* eslint-env browser */
/* global SINGLE_FILE, MODEL_RESET_CACHE */
import { preloader } from '@discoveryjs/discovery/src/preloader.js';
import { decodeBase64 } from './inflate/decoder.js';

export const colorSchemeOptions = ({
    darkmode,
    darkmodePersistent,
    colorScheme = darkmode,
    colorSchemePersistent = darkmodePersistent
}) =>
    preloader.colorScheme
        ? { colorScheme, colorSchemePersistent }
        : { darkmode: colorScheme, darkmodePersistent: colorSchemePersistent };

export const loadStyle = SINGLE_FILE
    ? url => document.querySelector(`style[type="discovery/style"][src=${JSON.stringify(url)}]`).firstChild.nodeValue
    : url => ({ type: 'link', href: url });

export function load(module, styles, setup, dataLoaderOptions) {
    const container = document.body;
    const dataRequestId = String(Math.random()).slice(2, 18).padStart(16, '0');
    const loadData = preloader({
        ...dataLoaderOptions,
        loadDataOptions: {
            ...dataLoaderOptions.loadDataOptions,
            encodings: dataLoaderOptions.encodings,
            fetch: { headers: {
                // using Cache-Control to prevent stalling requests in Chromium & Safari
                // see https://stackoverflow.com/questions/27513994/chrome-stalls-when-making-multiple-requests-to-same-resource
                'Cache-Control': 'no-cache, no-transform',
                'x-data-request-id': dataRequestId
            } }
        },
        container
    });

    // alter loader API
    alterLoaderPush();

    // status of awating data generation
    if (dataLoaderOptions.dataSource === 'url' && dataLoaderOptions.data) {
        awaitingDataStatus(loadData, dataRequestId);
    }

    // main part
    return Promise.all([
        module,
        loadData
    ]).then(([init, dataset]) =>
        init({ ...setup, styles }, loadData.progressbar, loadData.disposeEmbed?.(), dataset)
    ).then(() => {
        loadData.el.remove();
    }, (error) => {
        const discoveryEl = document.querySelector('body > .discovery');
        const actionButtonsEl = document.createElement('div');

        if (MODEL_RESET_CACHE && setup.model?.cacheReset) {
            const resetBtn = document.createElement('button', 'view-button');

            resetBtn.className = 'view-button';
            resetBtn.innerHTML = 'Reload with no cache';
            resetBtn.onclick = () => fetch('drop-cache').then(() => location.reload());

            actionButtonsEl.append(resetBtn);
        }

        if (actionButtonsEl.firstChild) {
            actionButtonsEl.className = 'action-buttons';
            loadData.progressbar.el.before(actionButtonsEl);
        }

        if (!error.supressLoadDataError) {
            const el = document.createElement('pre');
            const errorTypeBadgeEl = document.createElement('div');
            const errorText = String(error);
            let errorStack = String(error.stack || '');

            if (errorStack.startsWith(errorText)) {
                errorStack = errorStack.slice(errorText.length);
            }

            errorTypeBadgeEl.className = 'error-type-badge';
            errorTypeBadgeEl.dataset.type = error.isFetchError
                ? 'server'
                : 'client';

            el.className = 'error';
            el.append(
                errorTypeBadgeEl,
                errorText + (errorStack ? '\n' + errorStack.replace(/^[\r\n]+/, '') : '')
            );

            loadData.progressbar.el.replaceWith(el);
        }

        loadData.disposeEmbed?.();
        loadData.progressbar.dispose();
        discoveryEl && discoveryEl.remove();
    });
}

function alterLoaderPush() {
    const { discoveryLoader } = window;
    const { push: origLoaderPush, finish: origLoaderFinish } = discoveryLoader || {};

    if (typeof origLoaderPush === 'function') {
        const buffer = [];
        let finished = null;
        let timer = null;

        // use buffered pushing to avoid blocking the main thread for too long
        function flushBuffered() {
            timer = null;
            origLoaderPush(buffer.shift());
            if (buffer.length > 0) {
                timer = setTimeout(flushBuffered, 10);
            } else if (finished !== null) {
                origLoaderFinish(...finished);
            }
        }

        function pushBuffered(chunk) {
            buffer.push(chunk);
            if (!timer) {
                timer = setTimeout(flushBuffered, 10);
            }
        }

        // patch loader API
        discoveryLoader.push = function(chunk) {
            discoveryLoader.push = discoveryLoader.discoveryCliBase64
                ? chunk => pushBuffered(decodeBase64(chunk))
                : pushBuffered;
            discoveryLoader.push(chunk);
        };
        discoveryLoader.finish = function(...args) {
            finished = args;
        };
    }
}

function createDataStatusBlock() {
    const dataStatusEl = document.createElement('div');

    dataStatusEl.className = 'data-status';
    dataStatusEl.innerHTML =
        '<div class="header">Getting data: <span class="elapsed-time"></span></div>' +
        '<div class="output"></div>';
    dataStatusEl.firstChild.addEventListener('click', function() {
        dataStatusEl.classList.toggle('collapsed');
    }, true);

    dataStatusEl.elapsedTimeEl = dataStatusEl.querySelector(':scope > .header > .elapsed-time');

    return dataStatusEl;
}

// shows status for a long awaiting data request
function awaitingDataStatus(loadData, dataRequestId) {
    let supressLoadDataError = false;
    let allowServerTimeUpdate = true;
    let isServerError = false;
    const dataStatusEl = createDataStatusBlock();
    const activateDataStatusBlock = () => {
        if (loadData.progressbar.value.stage === 'request' && !dataStatusEl.parentNode) {
            loadData.progressbar.el.getRootNode().append(dataStatusEl);
        }
    };
    const dataStatusListenInit = setTimeout(() => {
        if (loadData.progressbar.value.stage !== 'request') {
            return;
        }

        loadData.progressbar.subscribe(({ stage }, unsubscribe) => {
            if (stage !== 'request') {
                unsubscribe();
                dataStatusEl.classList.add('finished');
                dataStatusEventSource.close();
                allowServerTimeUpdate = false;
            }
        });

        const dataStatusEventSource = new EventSource('data-status?data-request-id=' + dataRequestId);
        let planTreeMap = null;
        let startTime;
        let serverTime;
        let optimisticServerTimeUpdateTimer;
        let optimisticServerTimeUpdateFrom;
        let lastStderrEl;
        const updateServerTime = (newServerTime) => {
            if (!allowServerTimeUpdate ||
                !isFinite(newServerTime) ||
                (serverTime !== undefined && newServerTime <= serverTime)) {
                return;
            }

            clearTimeout(optimisticServerTimeUpdateTimer);
            serverTime = Number(newServerTime);

            if (startTime && serverTime - startTime >= 1000) {
                dataStatusEl.elapsedTimeEl.textContent =
                    duration(serverTime - startTime, supressLoadDataError ? 1 : 0);
            }

            if (planTreeMap) {
                for (const { started, elapsedTimeEl } of planTreeMap.values()) {
                    if (started) {
                        elapsedTimeEl.textContent = duration(serverTime - started, 1);
                    }
                }
            }

            optimisticServerTimeUpdateFrom = Date.now();
            optimisticServerTimeUpdateTimer = setTimeout(
                () => updateServerTime(serverTime + (Date.now() - optimisticServerTimeUpdateFrom) - 5),
                42
            );
        };

        // dataStatusEventSource.addEventListener('open', () => {
        //     setTimeout(activateDataStatusBlock, 3000);
        // }, { once: true });

        dataStatusEventSource.addEventListener('message', message => {
            try {
                const data = JSON.parse(message.data);

                switch (data.type) {
                    case 'start':
                        setTimeout(activateDataStatusBlock, 3000);
                        startTime = data.timestamp;
                        isServerError = true;
                        break;

                    case 'finish':
                        // do nothing
                        break;

                    case 'crash':
                        supressLoadDataError = true;
                        activateDataStatusBlock();

                        if (planTreeMap) {
                            for (const { started, el } of planTreeMap.values()) {
                                if (started) {
                                    el.classList.add('crashed');
                                    el.classList.remove('started');
                                    el.classList.toggle('collapsed', el !== lastStderrEl);
                                }
                            }
                        }
                        break;

                    case 'stderr':
                    case 'stdout': {
                        const frameEl = document.createElement('div');

                        frameEl.className = data.type;
                        frameEl.append(String(data.chunk));

                        if (!planTreeMap) {
                            activateDataStatusBlock();
                            dataStatusEl.lastChild.append(frameEl);
                            scrollIntoViewIfNeeded(frameEl);
                        } else {
                            const step = planTreeMap.get(data.stepId);

                            if (step) {
                                step.contentEl.append(frameEl);
                                step.el.classList.add('has-output');
                                scrollIntoViewIfNeeded(frameEl);

                                if (data.type == 'stderr') {
                                    lastStderrEl = step.el;
                                }
                            }
                        }
                        break;
                    }

                    case 'plan': {
                        const planTree = createPlanTree(data.plan.steps);

                        planTreeMap = planTree.map;
                        dataStatusEl.lastChild.innerHTML = '';
                        dataStatusEl.lastChild.appendChild(planTree.el);

                        if (planTreeMap) {
                            activateDataStatusBlock();
                        }

                        break;
                    }

                    case 'plan-step-event': {
                        const step = planTreeMap.get(data.stepId);

                        if (step) {
                            switch (data.stepEvent) {
                                case 'start':
                                    step.started = data.timestamp;
                                    step.el.classList.add('started');
                                    scrollIntoViewIfNeeded(step.el);
                                    break;

                                case 'finish':
                                    step.elapsedTimeEl.textContent = duration(data.timestamp - step.started);
                                    step.started = false;
                                    step.el.classList.remove('started');
                                    step.el.classList.add('finished');
                                    break;

                                case 'summary':
                                    step.summaryEl.innerHTML = numDelim(data.data);
                                    break;

                                default:
                                    console.warn('Unhandled data status SSE pipeline step event', data);
                            }
                        } else {
                            console.warn('Pipeline step not found', data);
                        }

                        break;
                    }

                    default:
                        console.warn('Unhandled data status SSE event', data);
                }

                updateServerTime(data.timestamp);
            } catch (e) {
                console.error('SSE message parse error', e);
            }
        });

        dataStatusEventSource.addEventListener('server-time', ({ data }) => {
            updateServerTime(data);
        });

        dataStatusEventSource.addEventListener('done', () => {
            dataStatusEventSource.close();
            allowServerTimeUpdate = false;
        });
    }, 150);

    loadData.then(
        () => clearTimeout(dataStatusListenInit),
        (error) => {
            allowServerTimeUpdate = false;

            if (!isServerError) {
                return;
            }

            if (supressLoadDataError) {
                error.supressLoadDataError = true;
                loadData.el.classList.add('generate-data-crash');
            } else {
                dataStatusEl.classList.add('compliment-error', 'collapsed');
            }

            for (const el of dataStatusEl.querySelectorAll('.plan-step.started')) {
                el.classList.remove('started');
            }

            dataStatusEl.classList.add('crashed');
            dataStatusEl.firstChild.firstChild.textContent = 'Retrieving data failed ' +
                (dataStatusEl.elapsedTimeEl.textContent ? 'in ' : '');
        }
    );
}

function scrollIntoViewIfNeeded(el) {
    try {
        if (typeof el.scrollIntoViewIfNeeded === 'function') {
            el.scrollIntoViewIfNeeded(false);
        } else {
            el.scrollIntoView({ block: 'nearest' });
        }
    } catch (e) {}
}

function createPlanTree(steps, level = 0, map = new Map()) {
    const listEl = document.createElement('ul');

    listEl.className = 'plan-step-list';
    listEl.style.setProperty('--level', level);

    for (const step of steps) {
        const stepEl = listEl.appendChild(document.createElement('li'));
        const stepHeaderEl = stepEl.appendChild(document.createElement('div'));
        const stepHeaderToggleEl = stepHeaderEl.appendChild(document.createElement('span'));
        const stepHeaderStatusEl = stepHeaderEl.appendChild(document.createElement('span'));
        const stepHeaderContentEl = stepHeaderEl.appendChild(document.createElement('span'));
        const stepHeaderSummaryEl = stepHeaderEl.appendChild(document.createElement('span'));
        const stepHeaderElapsedTimeEl = stepHeaderEl.appendChild(document.createElement('span'));
        const stepContentEl = stepEl.appendChild(document.createElement('div'));

        map.set(step.id, {
            step,
            el: stepEl,
            elapsedTimeEl: stepHeaderElapsedTimeEl,
            summaryEl: stepHeaderSummaryEl,
            contentEl: stepContentEl,
            started: false
        });

        stepEl.className = 'plan-step collapsed';
        stepHeaderEl.className = 'plan-step__header';
        stepHeaderEl.addEventListener('click', () => stepEl.classList.toggle('collapsed'));
        stepHeaderToggleEl.className = 'plan-step__header-toggle';
        stepHeaderStatusEl.className = 'plan-step__header-status';
        stepHeaderContentEl.className = 'plan-step__header-content';
        stepHeaderContentEl.textContent = step.name || 'Untitled';
        stepHeaderSummaryEl.className = 'plan-step__header-summary';
        stepHeaderElapsedTimeEl.className = 'plan-step__elapsed-time';
        stepContentEl.className = 'plan-step__content';

        if (step.steps) {
            stepEl.append(createPlanTree(step.steps, level + 1, map).el);
        }
    }

    return { el: listEl, map: map.size ? map : null };
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function numDelim(value, escape = true) {
    const strValue = escape && typeof value !== 'number'
        ? escapeHtml(String(value))
        : String(value);

    if (strValue.length > 3) {
        return strValue.replace(
            /\.\d+(eE[-+]?\d+)?|\B(?=(\d{3})+(\D|$))/g,
            m => m || '<span class="num-delim"></span>'
        );
    }

    return strValue;
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

    return `${Math.floor(value / 60000)}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}`;
}
