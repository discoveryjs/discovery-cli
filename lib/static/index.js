/* eslint-env browser */

import setup from 'discovery-cli:setup';
import extensions from 'discovery-cli:extensions';
import { Widget } from '@discoveryjs/discovery';

export default function(options) {
    console.log('???');
    const widget = new Widget(document.body, null, options);

    document.title = setup.name;
    widget.page.define('default', [
        'h1:#.name',
        {
            view: 'ul',
            data: 'models',
            item: 'link:{ text: name, href: slug + "/" }'
        }
    ]);

    widget.apply(extensions);
    widget.setData(setup, setup);
}
