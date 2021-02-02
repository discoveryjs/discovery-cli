const archiver = require('archiver');
const bootstrap = require('./shared/bootstrap');
const utils = require('./shared/utils');
const { build } = require('./build');

module.exports = bootstrap.model(async function genStatic(modelConfig, options, config, configFile) {
    return await utils.section(`Build archive /${modelConfig.slug}${modelConfig.download}`, async () => {
        const archive = archiver('zip');
        const files = await build({
            ...options,
            data: true,
            modelDownload: false,
            modelResetCache: false,
            singleFile: true,
            output: __dirname
        }, config, configFile);

        utils.section('Add files to archive', () => {
            for (const [filename, content] of files) {
                utils.println(filename);
                archive.append(content, { name: filename });
            }
        });

        archive.finalize();

        return archive;
    });
});
