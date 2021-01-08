/* eslint-env browser */

import prepare from 'discovery-cli:prepare';
import extensions from 'discovery-cli:extensions';
import { App } from '@discoveryjs/discovery';

export default function(options, data) {
    const app = new App(document.body, options);

    app.apply(prepare);
    app.apply(extensions);

    if (data) {
        app.loadDataFromUrl(data, 'data');
    } else {
        app.renderPage();
    }
};
