/* eslint-env browser */
import extensions from 'discovery-cli:extensions';
import encodings from 'discovery-cli:encodings';
import { Widget as ViewModel, navButtons, router, embed } from '@discoveryjs/discovery';

export default function(setup, progressbar, embedState) {
    const model = {
        name: setup.name,
        version: setup.version,
        description: setup.description
    };
    const context = {
        model,
        models: setup.models
    };
    const viewModel = new ViewModel({
        ...model,
        container: document.body,
        styles: setup.styles,
        inspector: setup.inspector,
        darkmode: setup.darkmode,
        darkmodePersistent: setup.darkmodePersistent,
        encodings,
        extensions: [
            ...extensions,
            navButtons.indexPage,
            navButtons.discoveryPage,
            setup.inspector && navButtons.inspect,
            navButtons.darkmodeToggle,
            setup.router && router,
            setup.embed && embed.setup(embedState)
        ],
        defaultPage: [
            'h1:#.model.name',
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


    return viewModel.setData(setup.data, context, { progressbar });
}
