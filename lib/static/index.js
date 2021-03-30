/* eslint-env browser */
import setup from 'discovery-cli:setup';
import extensions from 'discovery-cli:extensions';
import { Widget, navButtons } from '@discoveryjs/discovery';

export default function(options, progressbar) {
    const widget = new Widget(document.body, null, options);
    const index = location.pathname.endsWith('/index.html') ? 'index.html' : '';

    document.title = setup.name;
    widget.dom.wrapper.style.opacity = 1; // FIXME: disable entry transition for index page, there must be a better way to achieve this
    widget.page.define('default', [
        'h1:#.name',
        {
            view: 'ul',
            data: 'models',
            item: `link:{ text: name, href: slug + "/${index}" }`
        }
    ]);

    widget.apply(extensions);
    widget.apply(navButtons.darkmodeToggle);

    return widget.setDataProgress(setup, setup, progressbar);
}
