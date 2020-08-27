const fs = require('fs');
const path = require('path');
const mime = require('mime');
const { Readable } = require('stream');
const bootstrap = require('./shared/bootstrap');
const gen = require('./shared/gen');
const { getDataPlaceholder } = require('./shared/utils');

module.exports = bootstrap(async function(options, config) {
    return new Promise(async resolve => {
        const { model } = options;

        const genDataStream = await gen['/data.json'](config.models[0], options);

        let genData = '';

        genDataStream.on('data', data => {
            genData += data;
        });

        genDataStream.on('end', () => {
            const html = `build/${model}/index.html`;
            const css = `build/${model}/model.css`;
            const favicon = `build/${model}/favicon.png`;
            const js = fs.readFileSync(`build/${model}/model.js`, 'utf8')
                .replace(new RegExp(`function ${getDataPlaceholder()}\\(\\){return.*}\\(\\)`), JSON.stringify(genData));

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
                        ? newOpenTag + js
                        : m;
                });

            const stream = new Readable();

            stream._read = function () {
                this.push(data);
                this.push(null);
            };

            resolve(stream);
        });
    });
});
