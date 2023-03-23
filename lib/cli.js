const path = require('path');
const embedValues = [
    'by-config',
    'enable',
    'disable'
];
const sourcemapValues = [
    'linked',
    'external',
    'inline',
    true,
    false
];

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
        'Path to store cache files (using .discoveryjs-cache by default when [dir] is not set)',
        (value = '') => path.resolve(process.cwd(), value),
        '.discoveryjs-cache'
    ],
    tmpdir: [
        '--tmpdir <dir>',
        'Path to directory of temporary cache files which are generating before committing to cache directory'
    ],
    noCache: [
        '--no-cache',
        'Disable data caching'
    ],
    checkCacheTtl: [
        '--check-cache-ttl',
        'Check data cache TTL before using it, option enforces to use actual (according to TTL) data only'
    ],
    minify: [
        '--no-minify',
        'Disable JS and CSS minification'
    ],
    dataCompression: [
        '--no-data-compression',
        'Disable HTML embedded data compression, when --single-file option is used'
    ],
    experimentalJsonxl: [
        '--experimental-jsonxl',
        'Enable experimental binary data encoding (codename JSONXL)'
    ],
    embed: [
        '--embed [mode]',
        'Specify an embed API: by-config (default), enable (when [mode] omitted) or disable',
        (value = 'enable') => {
            if (!embedValues.includes(value)) {
                throw new Error(`Bad value ${JSON.stringify(value)} for option --embed. Allowed values: ${
                    embedValues.map(v => JSON.stringify(v)).join(', ')
                }`);
            }

            return value;
        },
        'by-config'
    ],
    sourcemap: [
        '--sourcemap [mode]',
        'Enable source map generation, optional "mode" can be: linked (default, when [mode] is omitted), ' +
        'external or inline (see https://esbuild.github.io/api/#sourcemap for detail)',
        (value = 'linked') => {
            if (!sourcemapValues.includes(value)) {
                throw new Error(`Bad value ${JSON.stringify(value)} for option --sourcemap. Allowed values: ${
                    sourcemapValues.map(v => JSON.stringify(v)).join(', ')
                }`);
            }

            return (value === 'linked') || value;
        },
        false
    ]
};
