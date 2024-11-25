/* eslint-env browser */
import extensions from 'discovery-cli:extensions';
import encodings from 'discovery-cli:encodings';
import { Widget as ViewModel, navButtons, router, embed } from '@discoveryjs/discovery';

export default function(setup, progressbar, embedState) {
    const model = {
        name: setup.name,
        version: setup.version,
        description: setup.description,
        icon: setup.icon
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
        context,
        extensions: [
            navButtons.indexPage,
            navButtons.discoveryPage,
            setup.inspector && navButtons.inspect,
            navButtons.darkmodeToggle,
            setup.router && router,
            setup.embed && embed.setup(embedState),
            ...extensions
        ],
        defaultPage: [
            {
                view: 'switch',
                content: [
                    { when: () => viewModel.view.isDefined('app-header'), content: 'app-header:#.model' },
                    { content: 'h1{ className: "default-header", data: #.model.name }' }
                ]
            },
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

    if (typeof viewModel.setContext === 'function') {
        // discoveryjs > 1.0.0-beta.90
        return viewModel.setData(setup.data, { progressbar });
    } else {
        // discoveryjs <= 1.0.0-beta.90
        viewModel.context = context;
        return viewModel.setData(setup.data, viewModel.context, { progressbar });
    }
}
