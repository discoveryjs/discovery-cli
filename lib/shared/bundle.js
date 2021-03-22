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
            '        host.setPrepare((data, ...args) => {',
            '            for (const prepare of prepares) {',
            '                data = prepare(data, ...args) || data;',
            '            }',
            '        });',
            '    }',
            '}'
        ].join('\n');
}

function selectBundles(modelConfig) {
    const view = modelConfig.view || {};
    return view.bundles || {};
}

module.exports = async function(config, options, esbuildConfig, { cacheDispatcher, filter } = {}) {
    const outputDir = options.output;
    const files = new Map();
    const entryPoints = [];
    const bundleEntryPoints = new Map();
    const refSym = new Map();
    const refMap = new Map();
    const getRef = (ref) => {
        const newRef = refMap.size + path.extname(ref);
        refMap.set(newRef, ref);
        return newRef;
    };
    const mainModules = new Set([
        path.join(staticSrc, '/index.js'),
        path.join(staticSrc, '/model.js')
    ]);

    for (const modelConfig of config.models) {
        const jsRef = getRef(`${modelConfig.slug}/model.js`);
        const jsLoaderRef = getRef(`${modelConfig.slug}/model-loader.js`);
        files.set(`${jsRef}`, () => fs.readFileSync(staticSrc + '/model.js'));
        files.set(`${jsLoaderRef}`, () => fs.readFileSync(staticSrc + '/model-loader.js'));
        files.set(`${jsRef}/setup.js`, () => gen['/gen/setup.js'](modelConfig, options, config, cacheDispatcher));
        files.set(`${jsRef}/prepare.js`, () => prepare(modelConfig));
        files.set(`${jsRef}/extensions.js`, () => selectJsAssets(modelConfig));

        const cssRef = getRef(`${modelConfig.slug}/model.css`);
        const cssLoaderRef = getRef(`${modelConfig.slug}/model-loader.css`);
        files.set(`${cssRef}`, () => fs.readFileSync(staticSrc + '/model.css'));
        files.set(`${cssLoaderRef}`, () => fs.readFileSync(staticSrc + '/model-loader.css'));
        files.set(`${cssRef}/extensions.css`, () => selectCssAssets(modelConfig));

        entryPoints.push(jsRef, jsLoaderRef, cssRef, cssLoaderRef);
        refSym.set(jsLoaderRef, jsRef);
        refSym.set(cssLoaderRef, cssRef);

        for (const [relpath, entrypoint] of Object.entries(selectBundles(modelConfig))) {
            const ref = getRef(`${modelConfig.slug}/${relpath}`);

            bundleEntryPoints.set(ref, entrypoint);
            entryPoints.push(ref);
        }
    }

    if (config.mode === 'multi') {
        const jsRef = getRef('index.js');
        const jsLoaderRef = getRef('index-loader.js');
        files.set(`${jsRef}`, () => fs.readFileSync(staticSrc + '/index.js'));
        files.set(`${jsLoaderRef}`, () => fs.readFileSync(staticSrc + '/index-loader.js'));
        files.set(`${jsRef}/setup.js`, () => gen['/gen/setup.js'](null, options, config, cacheDispatcher));
        files.set(`${jsRef}/extensions.js`, () => selectJsAssets(config));

        const cssRef = getRef('index.css');
        const cssLoaderRef = getRef('index-loader.css');
        files.set(`${cssRef}`, () => fs.readFileSync(staticSrc + '/index.css'));
        files.set(`${cssLoaderRef}`, () => fs.readFileSync(staticSrc + '/index-loader.css'));
        files.set(`${cssRef}/extensions.css`, () => selectCssAssets(config));

        entryPoints.push(jsRef, jsLoaderRef, cssRef, cssLoaderRef);
        refSym.set(jsLoaderRef, jsRef);
        refSym.set(cssLoaderRef, cssRef);

        for (const [relpath, entrypoint] of Object.entries(selectBundles(config))) {
            const ref = getRef(`${relpath}`);

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
                            // FIXME: when https://github.com/evanw/esbuild/issues/945 will be resolved replace to:
                            // return { path: bundleEntryPoints.get(args.path) }
                            return {
                                namespace: 'workaround-entry-load',
                                path: args.path
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
                    path: (refSym.get(args.importer) || args.importer) + '/' + args.path.split(':')[1] + path.extname(args.importer)
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

                // FIXME: remove when entry point outpath will not be broken https://github.com/evanw/esbuild/issues/945
                onLoad({ namespace: 'workaround-entry-load', filter: /.*/ }, args => {
                    const filename = bundleEntryPoints.get(args.path);
                    return {
                        loader: path.extname(args.path) === '.css' ? 'css' : 'js',
                        resolveDir: path.dirname(filename),
                        contents: fs.readFileSync(filename)
                    };
                });

                onLoad({ namespace: 'discovery-cli', filter: /.*/ }, async args => {
                    const getContents = files.get(args.path);
                    const contents = typeof getContents === 'function' ? await getContents() : null;

                    return {
                        loader: path.extname(args.path) === '.css' ? 'css' : 'js',
                        resolveDir: staticSrc,
                        contents
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
            ? entryPoints.filter(ref => filter(refMap.get(ref)))
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
        ...esbuildConfig
    }).then(result => {
        // FIXME: remove when https://github.com/evanw/esbuild/issues/945 will be resolved
        for (const file of result.outputFiles) {
            file.path = path.join(path.dirname(file.path), refMap.get(path.basename(file.path, '.map'))) +
                (path.extname(file.path) === '.map' ? '.map' : '');

            if (esbuildConfig.sourcemap) {
                if (path.extname(file.path) === '.js') {
                    const text = file.text;

                    delete file.text; // since it's not writable

                    file.contents =
                    file.text = text
                        .replace(/\n\/\/# sourceMappingURL=(.*?)\.map\s*$/, (m, filename) => {
                            return '\n//# sourceMappingURL=' + path.basename(refMap.get(path.basename(filename))) + '.map';
                        });
                } else if (file.path.endsWith('.js.map')) {
                    const text = file.text;
                    const map = JSON.parse(text);

                    delete file.text; // since it's not writable

                    map.sources = map.sources.map(fn => {
                        if (!fn.startsWith('discovery-cli:')) {
                            return fn.replace(/^discovery-wrapper:\/?/, '');
                        }

                        const parts = fn.replace(/^discovery-cli:/, '').split('/');
                        const realpath = refMap.get(parts[0]);
                        let dir = path.dirname(realpath);

                        if (dir === '.') {
                            dir = '';
                        }

                        return 'discovery-cli:' + (!dir ? 'index/' : '') + (parts.length > 1 ? path.join(dir, parts[1]) : realpath);
                    });

                    file.contents =
                    file.text = JSON.stringify(map);
                }
            }
        }

        return result;
    });
};
