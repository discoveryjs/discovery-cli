/* eslint-env browser */
/* global MODEL_DOWNLOAD, MODEL_RESET_CACHE */
import prepare from 'discovery-cli:prepare';
import modelSetup from 'discovery-cli:model-setup';
import encodings from 'discovery-cli:encodings';
import extensions from 'discovery-cli:extensions';
import { App, embed } from '@discoveryjs/discovery';
import { colorSchemeOptions } from './common.js';

export default function(setup, progressbar, embedState, dataset) {
    const model = setup.model;
    const context = { model };
    const app = new App({
        name: model.name,
        version: model.version,
        description: model.description,
        icon: model.icon,
        mode: setup.mode,
        styles: setup.styles,
        ...colorSchemeOptions(model),
        upload: model.upload,
        inspector: model.inspector,
        router: model.router,
        encodings,
        context,
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

    // set data
    const setDatasetOptions = {
        progressbar,
        dataset
    };

    if (typeof app.setContext === 'function') {
        // discoveryjs > 1.0.0-beta.90
        if (dataset) {
            return app.setDataProgress(dataset.data, null, setDatasetOptions);
        }
    } else {
        // discoveryjs <= 1.0.0-beta.90
        app.context = context;

        if (dataset) {
            return app.setDataProgress(dataset.data, context, setDatasetOptions);
        }

        return app.scheduleRender();
    }
};
