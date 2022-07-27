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

        dataStatusEventSource.addEventListener('open', () => {
            dataStatusEl.classList.remove('init');
        }, { once: true });

        dataStatusEventSource.addEventListener('message', message => {
            try {
                const data = JSON.parse(message.data);

                if (data.type === 'stderr' || data.type === 'stdout') {
                    const frameEl = document.createElement('div');

                    frameEl.className = data.type;
                    frameEl.append(document.createTextNode(data.chunk));

                    dataStatusEl.lastChild.append(frameEl);
                    dataStatusEl.lastChild.scrollTop = dataStatusEl.lastChild.scrollHeight;
                }
            } catch (e) {
                console.error('SSE message parse error', e);
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
        '<div class="header">Generating data progress:</div>' +
        '<div class="output"></div>';

    loadData.then(() => clearTimeout(dataStatusListenInit));
    loadData.progressbar.el.append(dataStatusEl);
}
