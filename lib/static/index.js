/* eslint-env browser */
import setup from 'discovery-cli:setup';
import extensions from 'discovery-cli:extensions';
import { Widget, navButtons } from '@discoveryjs/discovery';

export default function(options, progressbar) {
    const index = location.pathname.endsWith('/index.html') ? 'index.html' : '';
    const context = {
        name: setup.name,
        models: setup.models
    };
    const widget = new Widget({
        ...options,
        extensions: [
            ...extensions,
            navButtons.darkmodeToggle
        ],
        defaultPage: [
            'h1:#.name',
            {
                view: 'ul',
                data: '#.models',
                item: `link:{ text: name, href: slug + "/${index}" }`
            }
        ]
    });

    return widget.setDataProgress(setup.data, context, progressbar);
}
