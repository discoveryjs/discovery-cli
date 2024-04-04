/* eslint-env browser */
import extensions from 'discovery-cli:extensions';
import encodings from 'discovery-cli:encodings';
import { Widget, navButtons, embed } from '@discoveryjs/discovery';

export default function(setup, progressbar, embedState) {
    const context = {
        name: setup.name,
        models: setup.models
    };
    const widget = new Widget({
        container: document.body,
        styles: setup.styles,
        darkmode: setup.darkmode,
        darkmodePersistent: setup.darkmodePersistent,
        encodings,
        extensions: [
            ...extensions,
            navButtons.darkmodeToggle,
            ...setup.embed ? [embed.setup(embedState)] : []
        ],
        defaultPage: [
            'h1:#.name',
            {
                view: 'ul',
                data: '#.models',
                item: `link{
                    onClick: 'openModel'.actionHandler(slug, href),
                    data: {
                        slug,
                        text: name,
                        href: url
                    }
                }`
            }
        ]
    });

    return widget.setData(setup.data, context, progressbar);
}
