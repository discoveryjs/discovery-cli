/* eslint-env browser */

import setup from 'discovery-cli:setup';
import { loader } from '@discoveryjs/discovery/src/loader';

loader({
    module: import('./model.js').then(module => module.default),
    styles: ['model.css'],
    data: setup.data,
    options: {
        mode: setup.mode,
        setup,
        ...setup.model
            ? {
                cache: setup.model.cache,
                darkmode: setup.model.darkmode
            }
            : null
    }
});

