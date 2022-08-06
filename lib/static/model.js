/* eslint-env browser */
/* global MODEL_DOWNLOAD, MODEL_RESET_CACHE */
import prepare from 'discovery-cli:prepare';
import extensions from 'discovery-cli:extensions';
import { App } from '@discoveryjs/discovery';

export default function(options, progressbar, data, context) {
    const index = location.pathname.endsWith('/index.html') ? '/index.html' : '';
    const app = new App(options);

    app.apply(prepare);
    app.apply(extensions);
    context = { ...context, meta: options.meta };

    if (MODEL_DOWNLOAD && options.download) {
        app.nav.menu.append({
            name: 'download',
            data: {
                text: 'Download as single page',
                href: options.download
            }
        });
    }

    if (MODEL_RESET_CACHE && options.cacheReset) {
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

    if (options.mode === 'multi') {
        app.nav.menu.append({
            name: 'switch-model',
            data: {
                text: 'Switch model',
                href: `..${index}`
            }
        });
    }

    if (data) {
        return app.setDataProgress(data, context, progressbar);
    }

    app.context = context;
    return app.renderPage();
};
