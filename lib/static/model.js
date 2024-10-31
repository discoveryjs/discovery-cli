/* eslint-env browser */
/* global MODEL_DOWNLOAD, MODEL_RESET_CACHE */
import prepare from 'discovery-cli:prepare';
import modelSetup from 'discovery-cli:model-setup';
import encodings from 'discovery-cli:encodings';
import extensions from 'discovery-cli:extensions';
import { App, embed } from '@discoveryjs/discovery';

export default function(setup, progressbar, embedState, dataset) {
    const model = setup.model;
    const app = new App({
        name: model.name,
        description: model.description,
        version: model.version,
        mode: setup.mode,
        styles: setup.styles,
        darkmode: model.darkmode,
        darkmodePersistent: model.darkmodePersistent,
        upload: model.upload,
        inspector: model.inspector,
        router: model.router,
        encodings,
        setup: modelSetup,
        extensions: [
            model.embed && embed.setup(embedState),
            !modelSetup && prepare,
            ...extensions
        ]
    });

    if (MODEL_DOWNLOAD && model.download) {
        app.nav.menu.append({
            name: 'download',
            data: {
                text: 'Download as single page',
                href: model.download
            }
        });
    }

    if (MODEL_RESET_CACHE && model.cacheReset) {
        app.nav.menu.append({
            name: 'drop-cache',
            content: 'text:"Reload with no cache"',
            onClick: () => fetch('drop-cache').then(() => location.reload())
        });

        progressbar.subscribe(async ({ error }) => {
            if (error) {
                const buffer = document.createDocumentFragment();
                await app.view.render(buffer, {
                    view: 'button',
                    content: 'text:"Reload with no cache"',
                    onClick: () => fetch('drop-cache').then(() => location.reload())
                });
                app.dom.loadingOverlay.querySelector('.action-buttons').prepend(buffer);
            }
        });
    }

    if (setup.mode === 'multi') {
        app.nav.menu.append({
            name: 'switch-model',
            onClick: '=$handler:"openModelIndex".actionHandler(href); $hide: #.hide; $handler and => $hide() or $handler()',
            data: {
                text: 'Switch model',
                href: setup.indexUrl
            }
        });
    }

    // set data & context
    const context = {
        model
    };

    if (dataset) {
        return app.setDataProgress(dataset.data, context, {
            progressbar,
            dataset
        });
    }

    app.context = context;
    return app.renderPage();
};
