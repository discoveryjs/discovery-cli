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
        'Enable data caching and specify path to store cache files (using .discoveryjs-cache by default when [dir] is not set)',
        (value = '') => path.resolve(process.cwd(), value),
        '.discoveryjs-cache'
    ],
    tmpdir: [
        '--tmpdir [dir]',
        'Temporary directory for caches'
    ],
    noCache: [
        '--no-cache',
        'Disable data caching'
    ],
    checkCacheTtl: [
        '--check-cache-ttl',
        'Check data cache TTL before using it, option enforces to used actual (according to TTL) data only'
    ]
};
