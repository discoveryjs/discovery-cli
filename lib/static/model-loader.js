/* eslint-env browser */
/* global SINGLE_FILE */
import setup from 'discovery-cli:setup';
import encodings from 'discovery-cli:encodings';
import { colorSchemeOptions, load, loadStyle } from './common.js';

load(
    // we can't use setup.assets['model.js'] here for single-file mode, since esbuild will not detect import()
    import(SINGLE_FILE ? './model.js' : setup.assets['model.js']).then(module => module.default),
    [loadStyle(setup.assets['model.css'])],
    setup,
    {
        styles: [loadStyle(setup.assets['model-loader.css'])],
        embed: setup.model.embed,
        ...colorSchemeOptions(setup.model),
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
