const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const gen = require('./gen');
const discoveryDir = require('./discovery-dir');
const staticSrc = path.join(__dirname, '../static');

function selectAssets(modelConfig) {
    const view = modelConfig.view || {};
    const baseURI = view.basedir || view.base || '';

    return Array.isArray(view.assets)
        ? view.assets.map(fn => path.resolve(baseURI, fn))
        : [];
}

module.exports = async function(config, options, esbuildConfig, { cacheDispatcher, filter } = {}) {
    const outputDir = options.output;
    const files = new Map();
    const entryPoints = [];
    const mainModules = new Set([
        path.join(staticSrc, '/index.js'),
        path.join(staticSrc, '/model.js')
    ]);

    for (const modelConfig of config.models) {
        const jsRef = `${modelConfig.slug}/${modelConfig.slug}.js`;
        const jsLoaderRef = `${modelConfig.slug}/${modelConfig.slug}-loader.js`;
        files.set(`${jsRef}`, () => fs.readFileSync(staticSrc + '/model.js'));
        files.set(`${jsLoaderRef}`, () => fs.readFileSync(staticSrc + '/model-loader.js'));
        files.set(`${modelConfig.slug}/setup.js`, () => gen['/gen/setup.js'](modelConfig, options, config, cacheDispatcher));
        files.set(`${modelConfig.slug}/prepare.js`, () => [
            ['modelPrepare', modelConfig.prepare]
        ].filter(([, path]) => path));
        files.set(`${modelConfig.slug}/extensions.js`, () => selectAssets(modelConfig)
            .filter(fn => /\.[tj]sx?/.test(path.extname(fn)))
        );

        const cssRef = `${modelConfig.slug}/${modelConfig.slug}.css`;
        const cssLoaderRef = `${modelConfig.slug}/${modelConfig.slug}-loader.css`;
        files.set(`${cssRef}`, () => fs.readFileSync(staticSrc + '/model.css'));
        files.set(`${cssLoaderRef}`, () => fs.readFileSync(staticSrc + '/model-loader.css'));
        files.set(`${modelConfig.slug}/extensions.css`, () => selectAssets(modelConfig)
            .filter(fn => path.extname(fn) === '.css')
        );

        entryPoints.push(jsRef, jsLoaderRef, cssRef, cssLoaderRef);
    }

    if (config.mode === 'multi') {
        const jsRef = 'index/index.js';
        const jsLoaderRef = 'index/index-loader.js';
        files.set(`${jsRef}`, () => fs.readFileSync(staticSrc + '/index.js'));
        files.set(`${jsLoaderRef}`, () => fs.readFileSync(staticSrc + '/index-loader.js'));
        files.set('index/setup.js', () => gen['/gen/setup.js'](null, options, config, cacheDispatcher));
        files.set('index/extensions.js', () => selectAssets(config)
            .filter(fn => /\.[tj]sx?/.test(path.extname(fn)))
        );

        const cssRef = 'index/index.css';
        const cssLoaderRef = 'index/index-loader.css';
        files.set(`${cssRef}`, () => fs.readFileSync(staticSrc + '/index.css'));
        files.set(`${cssLoaderRef}`, () => fs.readFileSync(staticSrc + '/index-loader.css'));
        files.set('index/extensions.css', () => selectAssets(config)
            .filter(fn => path.extname(fn) === '.css')
        );

        entryPoints.push(jsRef, jsLoaderRef, cssRef, cssLoaderRef);
    }

    return esbuild.build({
        plugins: [{
            name: 'discovery-cli',
            setup({ onResolve, onLoad }) {
                // @discovery/discovery
                onResolve({ filter: /^@discoveryjs\/discovery(\/|$)/ }, (args) => ({
                    path: require.resolve(args.path.replace(/^@discoveryjs\/discovery/, discoveryDir))
                }));

                // entry points
                onResolve({ namespace: '', filter: /.*/ }, args => args.namespace !== '' ? null : ({
                    namespace: 'discovery-cli',
                    path: args.path
                }));

                // entry point imports
                onResolve({ namespace: 'discovery-cli', filter: /^discovery-cli:(setup|prepare|extensions)$/ }, args => ({
                    namespace: 'discovery-cli',
                    path: path.dirname(args.importer) + '/' + args.path.split(':')[1] + path.extname(args.importer)
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
                    const filename = path.basename(args.path);
                    const getContents = files.get(args.path);
                    const contents = typeof getContents === 'function' ? await getContents() : null;

                    switch (filename) {
                        case path.dirname(args.path) + '.js':
                        case path.dirname(args.path) + '-loader.js': return {
                            resolveDir: staticSrc,
                            contents
                        };

                        case 'setup.js': return {
                            contents
                        };

                        case 'prepare.js': return {
                            resolveDir: '/',
                            contents: contents
                                .map(([name, path]) =>
                                    `import ${name} from ${JSON.stringify(path)};\n`
                                ).join('') +
                                [
                                    'export default function(host) {',
                                    `    const prepares = [${contents.map(([name]) => name).join(', ')}].filter(p => {`,
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
                                ].join('\n')
                        };

                        case 'extensions.js': return {
                            resolveDir: '/',
                            contents: 'export default [\n' +
                                contents
                                    .map(fn => '    require(' + JSON.stringify(fn + ':discovery') + ')')
                                    .join(',\n') +
                                '\n]'
                        };

                        case path.dirname(args.path) + '.css':
                        case path.dirname(args.path) + '-loader.css': return {
                            loader: 'css',
                            resolveDir: staticSrc,
                            contents
                        };

                        case 'extensions.css': return {
                            loader: 'css',
                            resolveDir: '/',
                            contents: contents
                                .map(fn => '@import url(' + JSON.stringify(fn) + ');')
                                .join('\n')
                        };
                    }
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
            ? entryPoints.filter(filter)
            : entryPoints,
        bundle: true,
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
    });
};
