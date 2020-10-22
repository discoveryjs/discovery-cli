/* eslint-env browser */

import { Widget } from './@discoveryjs/discovery/lib.js';
import setup from './gen/setup.js';
import views from './gen/index-view.js';       // generated file (model specific)

const widget = new Widget(document.body, null, {
    darkmode: setup.darkmode,
    darkmodePersistent: true,
    isolateStyleMarker: setup.isolateStyles
});

document.title = setup.name;
widget.page.define('default', [
    'h1:#.name',
    {
        view: 'ul',
        data: 'models',
        item: 'link:{ text: name, href: slug + "/" }'
    }
]);
widget.apply(views);

widget.setData(setup, setup);
