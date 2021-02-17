/* eslint-env browser */
/* global SINGLE_FILE */
import setup from 'discovery-cli:setup';
import { load, loadStyle } from './common.js';

const model = setup.model || {};
const options = {
    mode: setup.mode,
    darkmodePersistent: true,
    setup,
    ...model
        ? {
            darkmode: model.darkmode,
            download: model.download,
            cache: model.cache,
            cacheReset: model.cacheReset,
            meta: model.meta
        }
        : null
};

load(
    import('./model.js').then(module => module.default),
    ['model.css'],
    options,
    {
        styles: [SINGLE_FILE ? loadStyle('model-loader.css') : { type: 'link', href: 'model-loader.css' }],
        darkmode: options.darkmode,
        darkmodePersistent: options.darkmodePersistent,
        dataSource: SINGLE_FILE ? 'push' : 'url',
        data: setup.data
    }
);
