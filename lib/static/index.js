/* eslint-env browser */

import { Widget } from '@discoveryjs/discovery';
import setup from 'discovery:setup';
// import views from 'discovery:extensions';       // generated file (model specific)

const widget = new Widget(document.body, null, {
    darkmode: setup.darkmode !== undefined ? setup.darkmode : 'auto',
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
// widget.apply(views);

widget.setData(setup, setup);
