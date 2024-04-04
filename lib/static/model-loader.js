/* eslint-env browser */
/* global SINGLE_FILE */
import setup from 'discovery-cli:setup';
import encodings from 'discovery-cli:encodings';
import { load, loadStyle } from './common.js';

load(
    import('./model.js').then(module => module.default),
    [loadStyle(setup.assets['model.css'])],
    setup,
    {
        styles: [loadStyle(setup.assets['model-loader.css'])],
        embed: setup.model.embed,
        darkmode: setup.model.darkmode,
        darkmodePersistent: setup.model.darkmodePersistent,
        encodings,
        ...SINGLE_FILE
            ? {
                dataSource: 'push',
                data: Boolean(setup.model.data) || null
            }
            : {
                dataSource: 'url',
                data: setup.model.data
            }
    }
);
