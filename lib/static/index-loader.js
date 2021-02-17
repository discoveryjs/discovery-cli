/* eslint-env browser */
/* global SINGLE_FILE */
import setup from 'discovery-cli:setup';
import { load, loadStyle } from './common.js';

const options = {
    darkmode: setup.darkmode !== undefined ? setup.darkmode : 'auto',
    darkmodePersistent: true
};

load(
    import('./index.js').then(module => module.default),
    ['index.css'],
    options,
    {
        styles: [SINGLE_FILE ? loadStyle('index-loader.css') : { type: 'link', href: 'index-loader.css' }],
        ...options
    }
);
