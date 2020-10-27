const { build } = require('esbuild');

module.exports = function(inputFilename, options = {}) {
    return build({
        entryPoints: [inputFilename],
        bundle: true,
        write: false,
        ...options
    });
};
