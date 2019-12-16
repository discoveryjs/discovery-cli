/* eslint-env browser */

import { App } from '../@discoveryjs/discovery/lib.js';
import setup from './gen/setup.js';                // generated file
import { plugins } from './gen/model-libs.js';     // generated file
import modelPrepare from './gen/model-prepare.js'; // generated file (model specific)
import modelView from './gen/model-view.js';       // generated file (model specific)

const app = new App(document.body,
    setup.model
        ? { mode: setup.mode, cache: setup.model.cache }
        : { mode: 'modelfree' }
);

app.apply(plugins);
app.apply(modelView);
app.apply(modelPrepare);

if (app.mode !== 'modelfree') {
    app.loadDataFromUrl('./data.json', 'data');
} else {
    app.renderPage();
}
