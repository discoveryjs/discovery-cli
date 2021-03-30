const { runScript, logSlugMsg, prettyDuration } = require('../shared/utils');
const command = require('../shared/commands');

function generateArchive(modelConfig, options) {
    const { slug } = modelConfig;
    const args = [];

    if (options.configFile) {
        args.push(options.configFile);
    }

    args.push('--model', slug);
    args.push('--cachedir', options.cachedir);

    return runScript(command.archive, args);
}

module.exports = function download(modelConfig, options) {
    return (req, res, next) => {
        const { slug } = modelConfig;
        const startTime = Date.now();

        generateArchive(modelConfig, options)
            .then(({ stream, filename }) => {
                const timestamp = (new Date).toISOString().split('.')[0].replace(/\D/g, '').replace(/^\d{8}/, '$&-');
                const contentDisposition = filename || `${slug}-${timestamp}.zip`;

                res.set('Content-Type', 'application/zip');
                res.set('Content-Disposition', `attachment; filename="${contentDisposition}"`);

                return new Promise((resolve, reject) =>
                    stream
                        .on('error', reject)
                        .pipe(res)
                        .on('error', reject)
                        .on('finish', () => {
                            logSlugMsg(
                                slug,
                                `Responsed "${req.originalUrl}" as "${contentDisposition}" in`,
                                prettyDuration(Date.now() - startTime)
                            );
                            resolve();
                        })
                );
            })
            .catch(next);
    };
};
