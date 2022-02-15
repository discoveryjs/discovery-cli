/* eslint-env browser */
/* global SINGLE_FILE, MODEL_RESET_CACHE */
import { preloader } from '@discoveryjs/discovery/src/preloader';

export const loadStyle = SINGLE_FILE
    ? url => document.querySelector(`style[type="discovery/style"][src=${JSON.stringify(url)}]`).firstChild.nodeValue
    : url => ({ type: 'link', href: url });

export function load(module, styles, options, dataLoaderOptions) {
    const container = document.body;
    const loadData = preloader({
        ...dataLoaderOptions,
        container
    });

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
