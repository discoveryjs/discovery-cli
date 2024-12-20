const archiver = require('archiver');
const bootstrap = require('./shared/bootstrap');
const utils = require('./shared/utils');
const { build } = require('./build');

module.exports = bootstrap.model(async function genArchive(modelConfig, options, config, configFile) {
    const { slug } = modelConfig;

    return await utils.section(`Build archive for "${slug}" model`, async () => {
        const archive = archiver('zip');
        const { files, suppressedFailures } = await build({
            ...options,
            data: true,
            modelDownload: false,
            modelResetCache: false,
            singleFile: true,
            output: __dirname
        }, config, configFile);
        const timestamp = (new Date).toISOString().split('.')[0].replace(/\D/g, '').replace(/^\d{8}/, '$&-');
        const basename = `${slug}-${timestamp}`;
        const indexHtml = 'index.html';

        if (files.size === 1 && files.has(indexHtml)) {
            utils.println(`Rename ${indexHtml} to ${basename}.html`);
            files.set(`${basename}.html`, files.get(indexHtml));
            files.delete(indexHtml);
        }

        utils.section(`Add files to archive ${basename}.zip`, () => {
            for (const [filename, content] of files) {
                utils.println(filename);
                archive.append(content, { name: filename });
            }
        });

        archive.finalize();

        return {
            filename: `${basename}.zip`,
            stream: archive,
            suppressedFailures
        };
    });
});
