/* eslint-env browser */
import setup from 'discovery-cli:setup';
import { load } from './common.js';

const options = {
    mode: setup.mode,
    darkmodePersistent: true,
    setup,
    ...setup.model
        ? {
            cache: setup.model.cache,
            darkmode: setup.model.darkmode
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
        data: setup.data
    }
);
