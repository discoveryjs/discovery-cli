/* eslint-env browser */
import setup from 'discovery-cli:setup';
import extensions from 'discovery-cli:extensions';
import { Widget, navButtons, embed } from '@discoveryjs/discovery';

export default function(options, progressbar) {
    const context = {
        name: setup.name,
        models: setup.models
    };
    const widget = new Widget({
        ...options,
        extensions: [
            ...extensions,
            navButtons.darkmodeToggle,
            ...options.embed ? [embed] : []
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
