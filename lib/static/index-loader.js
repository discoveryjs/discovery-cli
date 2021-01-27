/* eslint-env browser */
import setup from 'discovery-cli:setup';
import { load } from './common';

const options = {
    darkmode: setup.darkmode !== undefined ? setup.darkmode : 'auto',
    darkmodePersistent: true
};

load(
    import('./index.js').then(module => module.default),
    ['index.css'],
    options,
    options
);
