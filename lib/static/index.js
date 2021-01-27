/* eslint-env browser */
import setup from 'discovery-cli:setup';
import extensions from 'discovery-cli:extensions';
import { Widget } from '@discoveryjs/discovery';

export default function(options, progressbar) {
    const widget = new Widget(document.body, null, options);

    document.title = setup.name;
    widget.dom.wrapper.style.opacity = 1;
    widget.page.define('default', [
        'h1:#.name',
        {
            view: 'ul',
            data: 'models',
            item: 'link:{ text: name, href: slug + "/" }'
        }
    ]);

    widget.apply(extensions);

    return widget.setDataProgress(setup, setup, progressbar);
}
