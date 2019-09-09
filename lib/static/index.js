/* eslint-env browser */

import { Widget } from './@discoveryjs/discovery/lib.js';
import setup from './gen/setup.js';

const discovery = new Widget(document.body);

document.title = setup.name;
discovery.page.define('default', [
    'h1:#.name',
    {
        view: 'ul',
        data: 'models',
        item: 'link:{ text: name, href: slug + "/" }'
    }
]);

discovery.setData(setup, setup);
