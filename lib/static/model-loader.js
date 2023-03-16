/* eslint-env browser */
/* global SINGLE_FILE */
import setup from 'discovery-cli:setup';
import { load, loadStyle } from './common.js';

const model = setup.model;
const options = {
    mode: setup.mode,
    indexUrl: setup.indexUrl,
    darkmode: model.darkmode,
    darkmodePersistent: true,
    upload: model.upload,
    download: model.download,
    embed: model.embed,
    inspector: model.inspector,
    router: model.router,
    cache: model.cache,
    cacheReset: model.cacheReset,
    meta: model.meta
};

load(
    import(SINGLE_FILE
        ? './model.js' // so that esbuild can recognize the expression and add the module to a single bundle
        : setup.assets['model.js']
    ).then(module => module.default),
    [loadStyle(setup.assets['model.css'])],
    options,
    {
        styles: [loadStyle(setup.assets['model-loader.css'])],
        darkmode: options.darkmode,
        darkmodePersistent: options.darkmodePersistent,
        ...SINGLE_FILE
            ? {
                dataSource: 'push',
                data: Boolean(setup.data) || null
            }
            : {
                dataSource: 'url',
                data: setup.data
            }
    }
);
