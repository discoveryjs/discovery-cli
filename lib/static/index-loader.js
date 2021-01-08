/* eslint-env browser */

import setup from 'discovery-cli:setup';
import { loader } from '@discoveryjs/discovery/src/loader';

loader({
    module: import('./index.js').then(module => module.default),
    styles: ['index.css'],
    data: null,
    options: {
        darkmode: setup.darkmode !== undefined ? setup.darkmode : 'auto',
        darkmodePersistent: true
    }
});

