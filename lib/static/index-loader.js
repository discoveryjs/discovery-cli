/* eslint-env browser */
import setup from 'discovery-cli:setup';
import { load, loadStyle } from './common.js';

load(
    import('./index.js').then(module => module.default),
    [loadStyle('index.css')],
    setup,
    {
        styles: [loadStyle('index-loader.css')],
        darkmode: setup.darkmode,
        darkmodePersistent: setup.darkmodePersistent
    }
);
