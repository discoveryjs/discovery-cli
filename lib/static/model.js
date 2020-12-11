/* eslint-env browser */

import { App } from '@discoveryjs/discovery';
import setup from 'discovery:setup';           // generated file
import prepare from 'discovery:prepare';       // generated file (model specific)
import extensions from 'discovery:extensions'; // generated file

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

app.apply(prepare);
app.apply(extensions);

if (setup.data) {
    app.loadDataFromUrl(setup.data, 'data');
} else {
    app.renderPage();
}
