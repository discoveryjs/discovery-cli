const { build } = require('esbuild');

module.exports = async function(inputFilename, options = {}) {
    const res = await build({
        entryPoints: [inputFilename],
        bundle: true,
        format: 'esm',
        define: {
            global: 'window'
        },
        logLevel: 'error',
        write: false,
        ...options
    });

    return {
        content: res.outputFiles[0].contents
    };
};
