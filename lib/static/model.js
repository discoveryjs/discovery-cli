/* eslint-env browser */
import prepare from 'discovery-cli:prepare';
import extensions from 'discovery-cli:extensions';
import { App } from '@discoveryjs/discovery';

export default function(options, progressbar, data, context) {
    console.log(options);
    const index = location.pathname.endsWith('/index.html') ? '/index.html' : '';
    const app = new App(document.body, options);

    app.apply(prepare);
    app.apply(extensions);

    if (options.download) {
        app.nav.menu.append({
            name: 'download',
            data: {
                text: 'Download report',
                href: options.download
            }
        });
    }

    if (options.cache) {
        app.nav.menu.append({
            name: 'drop-cache',
            content: 'text:"Reload with no cache"',
            onClick: () => fetch('drop-cache').then(() => location.reload())
        });
    }

    app.nav.menu.append({
        name: 'switch-model',
        data: {
            text: 'Switch model',
            href: `..${index}`
        }
    });

    if (data) {
        return app.setDataProgress(data, context, progressbar);
    }

    return app.renderPage();
};
