const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const gen = require('./gen');
const staticSrc = path.join(__dirname, '../static');

function booleanStr(value) {
    return value ? 'true' : 'false';
}

function selectAssets(modelConfig, includeServeOnlyAssets) {
    const view = modelConfig.view || {};
    const serveOnlyAssets = includeServeOnlyAssets && Array.isArray(view.serveOnlyAssets) ? view.serveOnlyAssets : [];
    const assets = Array.isArray(view.assets) ? view.assets : [];

    return [...new Set([...serveOnlyAssets, ...assets])];
}

function selectJsAssets(modelConfig, includeServeOnlyAssets) {
    return (
        'export default [\n' +
        selectAssets(modelConfig, includeServeOnlyAssets)
            .filter(fn => /\.[cm]?[jt]sx?$/.test(path.extname(fn)))
            .map(fn => '    require(' + JSON.stringify(fn + ':discovery') + ')')
            .join(',\n') +
        '\n]'
    );
}

function selectCssAssets(modelConfig, includeServeOnlyAssets) {
    return selectAssets(modelConfig, includeServeOnlyAssets)
        .filter(fn => path.extname(fn) === '.css')
        .map(fn => '@import url(' + JSON.stringify(fn) + ');')
        .join('\n');
}

function modelSetup(modelConfig) {
    if (modelConfig.setup) {
        return `export { default } from ${JSON.stringify(modelConfig.setup)};\n`;
    }

    return 'export default null;\n';
}

function prepare(modelConfig) {
    const prepares = [
        ['commonPrepare', modelConfig.commonPrepare],
        ['modelPrepare', modelConfig.prepare]
    ].filter(([, path]) => path);

    return prepares
        .map(([name, path]) =>
            `import ${name} from ${JSON.stringify(path)};\n`
        ).join('') +
        [
            'export default function(host) {',
            `    const prepares = [${prepares.map(([name]) => name).join(', ')}].filter(p => {`,
            '        if (typeof p === "function") return true;',
            '        console.warn("[discovery-cli] \\"prepare\\" module should return a function, but got " + typeof p);',
            '    });',
            '    if (prepares.length) {',
            '        host.setPrepare(async (data, ...args) => {',
            '            for (const prepare of prepares) {',
            '                data = await prepare(data, ...args) || data;',
            '            }',
            '            return data;',
            '        });',
            '    }',
            '}'
        ].join('\n');
}

function encodings(modelConfig) {
    const encodingList = [
        ['commonEncodings', modelConfig.commonEncodings],
        ['modelEncodings', modelConfig.encodings]
    ].filter(([, path]) => path);

    return encodingList
        .map(([name, path]) =>
            `import ${name} from ${JSON.stringify(path)};\n`
        ).join('') +
        `export default [${encodingList.map(([name]) => '...' + name).join(', ')}]`;
}

function selectBundles(modelConfig) {
    const view = modelConfig.view || {};
    return view.bundles || {};
}

function dirname(filepath) {
    const dir = path.dirname(filepath);

    return dir === '.' ? '' : `${dir}/`;
}

function getDiscoveryDir(workingDir) {
    const pkgJson = path.join(workingDir, 'package.json');
    const discoveryDir = fs.existsSync(pkgJson) && require(pkgJson).name === '@discoveryjs/discovery'
        ? workingDir
        : path.dirname(require.resolve('@discoveryjs/discovery/package.json', {
            paths: [workingDir]
        }));
    const discoveryDev = fs.existsSync(path.join(discoveryDir, 'src'));

    return { discoveryDir, discoveryDev };
}

const pluginDiscoveryPaths = (discoveryDir) => ({
    name: 'discovery-paths',
    setup({ onResolve, resolve }) {
        // rewrite path to @discoveryjs/dicovery to ensure a single instance is used,
        // since @discoveryjs/discovery-cli might has its own copy
        onResolve({ filter: /^@discoveryjs\/discovery(\/|$)/ }, args => {
            if (args.resolveDir !== discoveryDir) {
                return resolve(args.path, {
                    kind: args.kind,
                    resolveDir: discoveryDir
                });
            }
        });
    }
});

const pluginDiscoveryCli = (options, bundleEntryPoints, mainModules, files) => ({
    name: 'discovery-cli',
    setup({ onResolve, onLoad }) {
        // entry points
        onResolve({ namespace: '', filter: /.*/ }, args => {
            if (args.kind === 'entry-point') {
                if (bundleEntryPoints.has(args.path)) {
                    return {
                        path: bundleEntryPoints.get(args.path)
                    };
                }

                return {
                    namespace: 'discovery-cli',
                    path: args.path
                };
            }
        });

        // entry point imports
        onResolve({ namespace: 'discovery-cli', filter: /^discovery-cli:(setup|model-setup|prepare|extensions|encodings)$/ }, args => ({
            namespace: 'discovery-cli',
            path: dirname(args.importer) + args.path.split(':')[1] + path.extname(args.importer)
        }));
        onResolve({ namespace: 'discovery-cli', filter: /\/(model|index).js$/ }, (args) => {
            if (mainModules.has(path.join(args.resolveDir, args.path))) {
                if (!options.singleFile) {
                    return { external: true };
                }

                return {
                    namespace: 'discovery-cli',
                    path: args.importer.replace(/-loader/, '')
                };
            }
        });

        onLoad({ namespace: 'discovery-cli', filter: /.*/ }, async args => {
            const getContents = files.get(args.path);

            return {
                loader: path.extname(args.path) === '.css' ? 'css' : 'js',
                resolveDir: staticSrc,
                contents: await getContents()
            };
        });
    }
});
const pluginDiscoveryWrapper = {
    name: 'discovery-wrapper',
    setup({ onResolve, onLoad }) {
        onResolve({ filter: /:discovery$/ }, args => ({
            namespace: 'discovery-wrapper',
            path: args.path.replace(/:discovery$/, '')
        }));
        onLoad({ namespace: 'discovery-wrapper', filter: /$/ }, args => {
            const content = fs.readFileSync(args.path, 'utf8');
            const prelude = content.match(/^(?:(?:\/\/.*\n|\/\*.*?\*\/|\s+)*import.*;\n?)+/);
            const imports = prelude ? prelude[0] + '\n' : '';
            const body = prelude ? content.slice(prelude[0].length) : content;

            return {
                resolveDir: path.dirname(args.path),
                contents:
                    imports +
                    'export default function(discovery) {\n' +
                        body +
                    '\n}\n'
            };
        });
    }
};

module.exports = async function(config, options, esbuildConfig, { cacheDispatcher, filter } = {}) {
    const { discoveryDir, discoveryDev } = getDiscoveryDir(process.cwd());
    const outputDir = options.output;
    const files = new Map();
    const entryPoints = [];
    const bundleEntryPoints = new Map();
    const mainModules = new Set([
        path.join(staticSrc, '/index.js'),
        path.join(staticSrc, '/model.js')
    ]);

    for (const modelConfig of config.models) {
        const { slug } = modelConfig;
        files.set(`${slug}/model.js`, () => fs.readFileSync(staticSrc + '/model.js'));
        files.set(`${slug}/model-loader.js`, () => fs.readFileSync(staticSrc + '/model-loader.js'));
        files.set(`${slug}/model-setup.js`, () => modelSetup(modelConfig));
        files.set(`${slug}/setup.js`, () => gen['/setup.js'](modelConfig, options, config, cacheDispatcher));
        files.set(`${slug}/prepare.js`, () => prepare(modelConfig));
        files.set(`${slug}/encodings.js`, () => encodings(modelConfig));
        files.set(`${slug}/extensions.js`, () => selectJsAssets(modelConfig, options.serveOnlyAssets));

        files.set(`${slug}/model.css`, () => fs.readFileSync(staticSrc + '/model.css'));
        files.set(`${slug}/model-loader.css`, () => fs.readFileSync(staticSrc + '/model-loader.css'));
        files.set(`${slug}/extensions.css`, () => selectCssAssets(modelConfig, options.serveOnlyAssets));

        entryPoints.push(
            `${slug}/model.js`,
            `${slug}/model-loader.js`,
            `${slug}/model.css`,
            `${slug}/model-loader.css`
        );

        for (const [relpath, entrypoint] of Object.entries(selectBundles(modelConfig))) {
            const ref = `${modelConfig.slug}/${relpath}`;

            bundleEntryPoints.set(ref, entrypoint);
            entryPoints.push(ref);
        }
    }

    if (config.mode === 'multi') {
        files.set('index.js', () => fs.readFileSync(staticSrc + '/index.js'));
        files.set('index-loader.js', () => fs.readFileSync(staticSrc + '/index-loader.js'));
        files.set('setup.js', () => gen['/setup.js'](null, options, config, cacheDispatcher));
        files.set('encodings.js', () => encodings(config));
        files.set('extensions.js', () => selectJsAssets(config, options.serveOnlyAssets));

        files.set('index.css', () => fs.readFileSync(staticSrc + '/index.css'));
        files.set('index-loader.css', () => fs.readFileSync(staticSrc + '/index-loader.css'));
        files.set('extensions.css', () => selectCssAssets(config, options.serveOnlyAssets));

        entryPoints.push(
            'index.js',
            'index-loader.js',
            'index.css',
            'index-loader.css'
        );

        for (const [relpath, entrypoint] of Object.entries(selectBundles(config))) {
            const ref = `${relpath}`;

            bundleEntryPoints.set(ref, entrypoint);
            entryPoints.push(ref);
        }
    }

    const result = await esbuild.build(esbuildConfig = {
        entryPoints: typeof filter === 'function'
            ? entryPoints.filter(ref => filter(ref))
            : entryPoints,
        conditions: options.dev && discoveryDev ? ['discovery-dev'] : [],
        plugins: [
            pluginDiscoveryPaths(discoveryDir),
            pluginDiscoveryCli(options, bundleEntryPoints, mainModules, files),
            pluginDiscoveryWrapper
        ],
        bundle: true,
        // metafile: true,
        format: options.singleFile ? 'iife' : 'esm',
        define: {
            global: 'window',
            SINGLE_FILE: booleanStr(options.singleFile),
            MODEL_DOWNLOAD: booleanStr(options.modelDownload),
            MODEL_RESET_CACHE: booleanStr(options.modelResetCache)
        },
        loader: {
            '.ico': 'dataurl',
            '.png': 'dataurl',
            '.gif': 'dataurl',
            '.jpg': 'dataurl',
            '.svg': 'dataurl',
            '.wasm': 'base64'
        },
        write: false,
        // splitting: true,
        minify: true,
        outdir: outputDir,
        outbase: '.',
        target: 'esnext',
        ...esbuildConfig
    });

    if (esbuildConfig.sourcemap) {
        // rewrite source maps references to real module paths
        for (const file of result.outputFiles) {
            if (file.path.endsWith('.js.map')) {
                const text = file.text;
                const map = JSON.parse(text);

                delete file.text; // since it's not writable

                map.sources = map.sources.map(fn => {
                    if (!fn.startsWith('discovery-cli:')) {
                        return fn.replace(/^..\//, '').replace(/^discovery-wrapper:\/?/, '');
                    }

                    const realpath = fn.replace(/^discovery-cli:/, '');
                    let dir = path.dirname(realpath);

                    if (dir === '.') {
                        dir = '';
                    }

                    return 'discovery-cli:' + (!dir ? 'index/' : '') + realpath;
                });

                file.contents =
                file.text = JSON.stringify(map);
            }
        }
    }

    return result;
};
