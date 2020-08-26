const fs = require('fs');
const path = require('path');
const mime = require('mime');
const { Readable } = require('stream');
const bootstrap = require('./shared/bootstrap');

module.exports = bootstrap(async function(options) {
    const { model } = options;

    const html = `build/${model}/index.html`;
    const css = `build/${model}/model.css`;
    const js = `build/${model}/model.js`;
    const favicon = `build/${model}/favicon.png`;

    const data = fs.readFileSync(html, 'utf8')
        .replace(/<link rel="icon".+?>/g, m => {
            return m.replace(/\s+href="(.+?)"/, (m, filepath) =>
                ` href="data:${
                    mime.getType(path.extname(filepath))
                };base64,${
                    fs.readFileSync(favicon, 'base64')
                }"`
            );
        })
        .replace(/<link rel="stylesheet".+?>/g, m => {
            const hrefMatch = m.match(/\s+href="(.+?)"/);

            return hrefMatch
                ? `<style>${fs.readFileSync(css)}</style>`
                : m;
        })
        .replace(/<script .+?>/g, m => {
            let scriptSrc = null;
            const newOpenTag = m.replace(/\s+src="(.+?)"/, (m, src) => (scriptSrc = src, ''));

            return scriptSrc
                ? newOpenTag + fs.readFileSync(js, 'utf8')
                : m;
        });

    const stream = new Readable();

    stream._read = function() {
        this.push(data);
        this.push(null);
    };

    return stream;
});
