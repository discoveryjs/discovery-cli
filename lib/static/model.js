/* eslint-env browser */
/* global MODEL_DOWNLOAD, MODEL_RESET_CACHE */
import prepare from 'discovery-cli:prepare';
import extensions from 'discovery-cli:extensions';
import { App } from '@discoveryjs/discovery';

export default function(setup, progressbar, data, context) {
    const model = setup.model;
    const app = new App({
        mode: setup.mode,
        styles: setup.styles,
        darkmode: model.darkmode,
        darkmodePersistent: model.darkmodePersistent,
        upload: model.upload,
        embed: model.embed,
        inspector: model.inspector,
        router: model.router
    });

    app.apply(prepare);
    app.apply(extensions);
    context = {
        ...context,
        meta: model.meta || null
    };

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

        progressbar.onErrorRender = async (error, el) => {
            const buffer = document.createDocumentFragment();
            await app.view.render(buffer, {
                view: 'button',
                content: 'text:"Reload with no cache"',
                onClick: () => fetch('drop-cache').then(() => location.reload())
            });
            (el.querySelector('.action-buttons') || el).prepend(buffer);
        };
    }

    if (setup.mode === 'multi') {
        app.nav.menu.append({
            name: 'switch-model',
            data: {
                text: 'Switch model',
                href: setup.indexUrl
            }
        });
    }

    if (data) {
        return app.setDataProgress(data, context, progressbar);
    }

    app.context = context;
    return app.renderPage();
};
