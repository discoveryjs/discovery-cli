/* eslint-env browser */

import { Widget } from './@discoveryjs/discovery/lib.js';
import setup from './gen/setup.js';

const widget = new Widget(document.body);

document.title = setup.name;
widget.page.define('default', [
    'h1:#.name',
    {
        view: 'ul',
        data: 'models',
        item: 'link:{ text: name, href: slug + "/" }'
    }
]);

widget.setData(setup, setup);
