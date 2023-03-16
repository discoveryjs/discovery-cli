/* eslint-env browser */
import extensions from 'discovery-cli:extensions';
import { Widget, navButtons, embed } from '@discoveryjs/discovery';

export default function(setup, progressbar) {
    const context = {
        name: setup.name,
        models: setup.models
    };
    const widget = new Widget({
        container: document.body,
        styles: setup.styles,
        darkmode: setup.darkmode,
        darkmodePersistent: setup.darkmodePersistent,
        extensions: [
            ...extensions,
            navButtons.darkmodeToggle,
            ...setup.embed ? [embed] : []
        ],
        defaultPage: [
            'h1:#.name',
            {
                view: 'ul',
                data: '#.models',
                item: 'link:{ text: name, href: url }'
            }
        ]
    });

    return widget.setDataProgress(setup.data, context, progressbar);
}
