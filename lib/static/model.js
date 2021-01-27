/* eslint-env browser */
import prepare from 'discovery-cli:prepare';
import extensions from 'discovery-cli:extensions';
import { App } from '@discoveryjs/discovery';

export default function(options, progressbar, data, context) {
    const app = new App(document.body, options);

    app.apply(prepare);
    app.apply(extensions);

    if (data) {
        return app.setDataProgress(data, context, progressbar);
    }

    return app.renderPage();
};
