/* eslint-env browser */
/* global SINGLE_FILE */
import setup from 'discovery-cli:setup';
import { load } from './common.js';

const options = {
    mode: setup.mode,
    darkmodePersistent: true,
    setup,
    ...setup.model
        ? {
            cache: setup.model.cache,
            darkmode: setup.model.darkmode,
            download: setup.model.download
        }
        : null
};

load(
    import('./model.js').then(module => module.default),
    ['model.css'],
    options,
    {
        darkmode: options.darkmode,
        darkmodePersistent: options.darkmodePersistent,
        dataSource: SINGLE_FILE ? 'push' : 'url',
        data: setup.data
    }
);
