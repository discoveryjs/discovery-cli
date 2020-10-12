const fs = require('fs');
const path = require('path');
const mime = require('mime');
const archiver = require('archiver');
const bootstrap = require('./shared/bootstrap');
const createCacheDispatcher = require('./shared/cache-dispatcher');
const gen = require('./shared/gen');
const { DATA_PLACEHOLDER, MODE_PLACEHOLDER, SETUP_MODEL_PLACEHOLDER } = require('./shared/utils');

module.exports = bootstrap.model(function genStatic(modelConfig, options) {
    const cacheDispatcher = createCacheDispatcher([modelConfig], { cacheDir: options.cacheDir });
    return new Promise(async resolve => {
        const { model, dir } = options;

        const { stream: genDataStream } = await cacheDispatcher.read(modelConfig.slug)
            .then(cache => {
                if (!cache) {
                    return gen['/data.json'](modelConfig, options);
                }

                return {
                    stream: fs.createReadStream(cache.file)
                };
            });

        let genData = '';

        genDataStream.on('data', data => {
            genData += data;
        });

        genDataStream.on('end', () => {
            const html = `${dir}/${model}/index.html`;
            const css = `${dir}/${model}/model.css`;
            const favicon = `${dir}/${model}/favicon.png`;
            const js = fs.readFileSync(`${dir}/${model}/model.js`, 'utf8')
                .replace(new RegExp(`function ${MODE_PLACEHOLDER}\\(\\){return.*?}\\(\\)`), '"single"')
                .replace(new RegExp(`function ${SETUP_MODEL_PLACEHOLDER}\\(\\){return.*?}\\(\\)`), JSON.stringify({ ...modelConfig, download: false, cache: false}))
                .replace(new RegExp(`function ${DATA_PLACEHOLDER}\\(\\){return.*?}\\(\\)`), JSON.stringify(genData));

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

            const archive = archiver('zip');

            archive.append(data, { name: `${model}.html`});
            archive.finalize();

            resolve(archive);
        });
    });
});
