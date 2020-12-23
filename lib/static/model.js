/* eslint-env browser */

import setup from 'discovery-cli:setup';
import prepare from 'discovery-cli:prepare';
import extensions from 'discovery-cli:extensions';
import { App } from '@discoveryjs/discovery';

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
