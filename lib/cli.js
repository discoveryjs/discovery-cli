const path = require('path');

// common options
module.exports = {
    config: [
        '-c, --config <filename>',
        'Path to config (JavaScript or JSON file), if not specified then looking for .discoveryrc.js, .discoveryrc.json, .discoveryrc or "discovery" section in package.json in the listed order'
    ],
    model: [
        '-m, --model <name>',
        'Specify a model (multi-model mode only)'
    ],
    cachedir: [
        '--cachedir [dir]',
        'Enable data caching and specify path to store cache files (using a .discoveryjs-cache directory if not set)',
        (value = '') => path.resolve(process.cwd(), value),
        '.discoveryjs-cache'
    ],
    noCache: [
        '--no-cache',
        'Disable data caching'
    ]
};
