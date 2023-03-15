/* eslint-env browser */
import setup from 'discovery-cli:setup';
import { load, loadStyle } from './common.js';

const options = {
    container: document.body,
    embed: setup.embed,
    darkmode: setup.darkmode !== undefined ? setup.darkmode : 'auto',
    darkmodePersistent: true
};

load(
    import('./index.js').then(module => module.default),
    [loadStyle('index.css')],
    options,
    {
        styles: [loadStyle('index-loader.css')],
        darkmode: options.darkmode,
        darkmodePersistent: options.darkmodePersistent
    }
);
