const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const gen = require('./gen');
const staticSrc = path.join(__dirname, '../static');

function selectAssets(modelConfig) {
    const view = modelConfig.view || {};
    const baseURI = view.basedir || view.base || '';

    return Array.isArray(view.assets)
        ? view.assets.map(fn => path.resolve(baseURI, fn))
        : [];
}

module.exports = async function(config, options, esbuildConfig, mode) {
    const outputDir = options.output;
    const entryPoints = Object.create(null);

    if (mode !== 'index-only') {
        for (const modelConfig of config.models) {
            entryPoints[`model.js/${modelConfig.slug}`] = {
                main: () => fs.readFileSync(staticSrc + '/model.js'),
                setup: () => gen['/gen/setup.js'](modelConfig, options, config),
                prepare: () => modelConfig.prepare,
                extensions: () => selectAssets(modelConfig)
                    .filter(fn => /\.[tj]sx?/.test(path.extname(fn)))
            };
            entryPoints[`model.css/${modelConfig.slug}`] = {
                main: () => fs.readFileSync(staticSrc + '/model.css'),
                extensions: () => selectAssets(modelConfig)
                    .filter(fn => path.extname(fn) === '.css')
            };
        }
    }

    if (mode !== 'model-only' && config.mode === 'multi') {
        entryPoints['index.js/index'] = {
            main: () => fs.readFileSync(staticSrc + '/index.js'),
            setup: () => gen['/gen/setup.js'](null, options, config),
            extensions: () => []
        };
        entryPoints['index.css/index'] = {
            main: () => fs.readFileSync(staticSrc + '/index.css'),
            extensions: () => []
        };
    }

    return esbuild.build({
        plugins: [{
            name: 'generated-module',
            setup({ onResolve, onLoad }) {
                // entry points
                onResolve({ namespace: '', filter: /.*/ }, args => args.namespace !== '' ? null : ({
                    namespace: 'gen',
                    path: args.path + '/' + path.basename(args.path) + path.extname(path.dirname(args.path))
                }));

                // entry point imports
                onResolve({ namespace: 'gen', filter: /^discovery-cli:(setup|prepare|extensions)$/ }, args => {
                    const ref = path.dirname(args.importer);

                    if (ref in entryPoints) {
                        return {
                            namespace: 'gen',
                            path: ref + '/' + args.path.split(':')[1] + path.extname(path.dirname(ref))
                        };
                    }
                });

                onLoad({ namespace: 'gen', filter: /.*/ }, async args => {
                    const ref = path.dirname(args.path);
                    const filename = path.basename(args.path);
                    const entryPoint = entryPoints[ref];

                    switch (filename) {
                        case path.basename(ref, '.js') + '.js': return {
                            resolveDir: staticSrc,
                            contents: entryPoint.main()
                        };

                        case 'setup.js': return {
                            contents: await entryPoint.setup()
                        };

                        case 'prepare.js': return {
                            resolveDir: '/',
                            contents: 'export default [\n' + (entryPoint.prepare && entryPoint.prepare()
                                ? '    require(' + JSON.stringify(entryPoint.prepare() + ':discovery') + ')'
                                : '') + '\n]'
                        };

                        case 'extensions.js': return {
                            resolveDir: '/',
                            contents: 'export default [\n' +
                                entryPoint.extensions()
                                    .map(fn => '    require(' + JSON.stringify(fn + ':discovery') + ')')
                                    .join(',\n') +
                                '\n]'
                        };

                        case path.basename(ref, '.css') + '.css': return {
                            loader: 'css',
                            resolveDir: staticSrc,
                            contents: entryPoint.main()
                        };

                        case 'extensions.css': return {
                            loader: 'css',
                            resolveDir: '/',
                            contents: entryPoint.extensions()
                                .map(fn => '@import url(' + JSON.stringify(fn) + ');')
                                .join('\n')
                        };
                    }
                });
            }
        }, {
            name: 'discovery-wrapper',
            setup({ onLoad }) {
                onLoad({ filter: /:discovery$/ }, args => ({
                    resolveDir: path.dirname(args.path),
                    contents: 'export default function(discovery) {\n' +
                        fs.readFileSync(args.path.replace(/:discovery$/, '')) +
                    '\n}'
                }));
            }
        }],
        entryPoints: Object.keys(entryPoints),
        bundle: true,
        format: 'esm',
        define: {
            global: 'window'
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
