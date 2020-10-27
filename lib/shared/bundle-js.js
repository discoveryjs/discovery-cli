const { build } = require('esbuild');

module.exports = function(inputFilename, options = {}) {
    return build({
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
};
