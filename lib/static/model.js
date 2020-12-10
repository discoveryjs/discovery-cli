/* eslint-env browser */

import { App } from '@discoveryjs/discovery';
import setup from './gen/setup.js';                // generated file
import { plugins } from './gen/model-libs.js';     // generated file
import modelView from './gen/model-view.js';       // generated file (model specific)
import modelPrepare from './gen/model-prepare.js'; // generated file (model specific)

const app = new App(document.body, {
    isolateStyleMarker: setup.isolateStyles,
    mode: setup.mode,
    setup,
    ...setup.model
        ? {
            cache: setup.model.cache,
            darkmode: setup.model.darkmode
        }
        : {} // for legacy reasons
});

app.apply(plugins);
app.apply(modelView);
app.apply(modelPrepare);

if (setup.data) {
    app.loadDataFromUrl(setup.data, 'data');
} else {
    app.renderPage();
}
