/* eslint-env browser */
/* global SINGLE_FILE, MODEL_RESET_CACHE */
import { preloader } from '@discoveryjs/discovery/src/preloader';

export const loadStyle = SINGLE_FILE
    ? url => document.querySelector(`style[type="discovery/style"][src=${JSON.stringify(url)}]`).firstChild.nodeValue
    : url => fetch(url).then(res => {
        if (!res.ok) {
            throw new Error(`Failed to load styles "${url}"`);
        }

        return res.text();
    });

export function load(module, styles, options, dataLoaderOptions) {
    const container = document.body;
    const loadData = preloader({
        ...dataLoaderOptions,
        container
    });

    return Promise.all([
        module,
        Promise.all(styles.map(loadStyle)),
        loadData
    ]).then(([init, styles, { data, context }]) =>
        init({ ...options, styles }, loadData.progressbar, data, context)
    ).then(() => {
        loadData.el.remove();
    }, (e) => {
        const el = document.createElement('pre');
        el.className = 'error';
        el.append(document.createTextNode('[ERROR] ' + e + (e.stack ? '\n\n' + e.stack : '')));

        loadData.progressbar.el.replaceWith(el);
        loadData.progressbar.dispose();

        if (MODEL_RESET_CACHE && options.cache) {
            const resetBtn = document.createElement('button', 'view-button');
            resetBtn.className = 'view-button';
            resetBtn.innerHTML = 'Reload with no cache';
            resetBtn.onclick = () => fetch('drop-cache').then(() => location.reload());

            el.before(resetBtn);
        }
    });
}
