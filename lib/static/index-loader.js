/* eslint-env browser */
import setup from 'discovery-cli:setup';
import encodings from 'discovery-cli:encodings';
import { colorSchemeOptions, load, loadStyle } from './common.js';

load(
    import('./index.js').then(module => module.default),
    [loadStyle('index.css')],
    setup,
    {
        styles: [loadStyle('index-loader.css')],
        embed: setup.embed,
        ...colorSchemeOptions(setup),
        encodings
    }
);
