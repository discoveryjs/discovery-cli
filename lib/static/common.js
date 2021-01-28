/* eslint-env browser */
/* global SINGLE_FILE */
import { preloader } from '@discoveryjs/discovery/src/preloader';

const loadStyle = SINGLE_FILE
    ? url => document.querySelector(`template[src=${JSON.stringify(url)}]`).content.textContent
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
    ).catch((e) => {
        const el = document.createElement('pre');
        el.style.cssText = 'margin:20px;padding:20px;font-size:14px;color:#d85a5a;background:#ff00002e;text-shadow:1px 1px var(--discovery-background-color)';
        el.append(document.createTextNode('[ERROR] ' + e + (e.stack ? '\n\n' + e.stack : '')));

        loadData.progressbar.el.replaceWith(el);
    }).finally(() =>
        loadData.progressbar.dispose()
    );
}
