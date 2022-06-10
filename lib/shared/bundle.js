const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const gen = require('./gen');
const discoveryDir = require('./discovery-dir');
const staticSrc = path.join(__dirname, '../static');

function selectAssets(modelConfig) {
    const view = modelConfig.view || {};

    return Array.isArray(view.assets) ? view.assets : [];
}

function selectJsAssets(modelConfig) {
    return (
        'export default [\n' +
        selectAssets(modelConfig)
            .filter(fn => /\.[tj]sx?/.test(path.extname(fn)))
            .map(fn => '    require(' + JSON.stringify(fn + ':discovery') + ')')
            .join(',\n') +
        '\n]'
    );
}

function selectCssAssets(modelConfig) {
    return selectAssets(modelConfig)
        .filter(fn => path.extname(fn) === '.css')
        .map(fn => '@import url(' + JSON.stringify(fn) + ');')
        .join('\n');
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

function selectBundles(modelConfig) {
    const view = modelConfig.view || {};
    return view.bundles || {};
}

function dirname(filepath) {
    const dir = path.dirname(filepath);

    return dir === '.' ? '' : `${dir}/`;
}

module.exports = async function(config, options, esbuildConfig, { cacheDispatcher, filter } = {}) {
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
        files.set(`${slug}/setup.js`, () => gen['/setup.js'](modelConfig, options, config, cacheDispatcher));
        files.set(`${slug}/prepare.js`, () => prepare(modelConfig));
        files.set(`${slug}/extensions.js`, () => selectJsAssets(modelConfig));

        files.set(`${slug}/model.css`, () => fs.readFileSync(staticSrc + '/model.css'));
        files.set(`${slug}/model-loader.css`, () => fs.readFileSync(staticSrc + '/model-loader.css'));
        files.set(`${slug}/extensions.css`, () => selectCssAssets(modelConfig));

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
        files.set('extensions.js', () => selectJsAssets(config));

        files.set('index.css', () => fs.readFileSync(staticSrc + '/index.css'));
        files.set('index-loader.css', () => fs.readFileSync(staticSrc + '/index-loader.css'));
        files.set('extensions.css', () => selectCssAssets(config));

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

    return esbuild.build(esbuildConfig = {
        plugins: [{
            name: 'discovery-cli',
            setup({ onResolve, onLoad }) {
                // @discovery/discovery
                onResolve({ filter: /^@discoveryjs\/discovery(\/|$)/ }, (args) => ({
                    path: require.resolve(args.path.replace(/^@discoveryjs\/discovery/, discoveryDir))
                }));

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
                onResolve({ namespace: 'discovery-cli', filter: /^discovery-cli:(setup|prepare|extensions)$/ }, args => ({
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
        }, {
            name: 'discovery-wrapper',
            setup({ onResolve, onLoad }) {
                onResolve({ filter: /:discovery$/ }, args => ({
                    namespace: 'discovery-wrapper',
                    path: args.path.replace(/:discovery$/, '')
                }));
                onLoad({ namespace: 'discovery-wrapper', filter: /.*$/ }, args => ({
                    resolveDir: path.dirname(args.path),
                    contents: 'export default function(discovery) {\n' +
                        fs.readFileSync(args.path) +
                    '\n}'
                }));
            }
        }],
        entryPoints: typeof filter === 'function'
            ? entryPoints.filter(ref => filter(ref))
            : entryPoints,
        bundle: true,
        // metafile: true,
        format: options.singleFile ? 'iife' : 'esm',
        define: {
            global: 'window',
            SINGLE_FILE: Boolean(options.singleFile),
            MODEL_DOWNLOAD: Boolean(options.modelDownload),
            MODEL_RESET_CACHE: Boolean(options.modelResetCache)
        },
        loader: {
            '.png': 'dataurl',
            '.gif': 'dataurl',
            '.jpg': 'dataurl',
            '.svg': 'dataurl'
        },
        write: false,
        // splitting: true,
        minify: true,
        outdir: outputDir,
        outbase: '.',
        target: 'esnext',
        ...esbuildConfig
    }).then(result => {
        if (esbuildConfig.sourcemap) {
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
    });
};
