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
    const modelJs = fs.readFileSync(staticSrc + '/model.js');
    const modelCss = fs.readFileSync(staticSrc + '/model.css');

    if (mode !== 'index-only') {
        for (const modelConfig of config.models) {
            entryPoints[`model.js/${modelConfig.slug}`] = {
                main: modelJs,
                setup: gen['/gen/setup.js'](modelConfig, options, config),
                prepare: modelConfig.prepare,
                extensions: selectAssets(modelConfig)
                    .filter(fn => /\.[tj]sx?/.test(path.extname(fn)))
            };
            entryPoints[`model.css/${modelConfig.slug}`] = {
                main: modelCss,
                extensions: selectAssets(modelConfig)
                    .filter(fn => path.extname(fn) === '.css')
            };
        }
    }

    if (config.mode === 'multi' && mode !== 'model-only') {
        entryPoints['index.js/index'] = {
            main: fs.readFileSync(staticSrc + '/index.js'),
            setup: gen['/gen/setup.js'](null, options, config),
            extensions: []
        };
        entryPoints['index.css/index'] = {
            main: fs.readFileSync(staticSrc + '/index.css'),
            extensions: []
        };
    }

    return esbuild.build({
        plugins: [{
            name: 'main',
            setup({ onResolve, onLoad }) {
                onResolve({ namespace: '', filter: /.*/ }, args => args.namespace !== '' ? null : ({
                    namespace: 'main',
                    path: args.path
                }));

                onLoad({ namespace: 'main', filter: /.*/ }, (args, type = path.extname(path.dirname(args.path)).slice(1)) => ({
                    loader: type,
                    resolveDir: staticSrc,
                    contents: entryPoints[args.path].main
                }));
            }
        }, {
            name: 'generated-module',
            setup({ onResolve, onLoad }) {
                onResolve({ filter: /^discovery-cli:(setup|prepare|extensions)$/ }, args => ({
                    namespace: args.path.split(':')[1] + path.extname(path.dirname(args.importer)),
                    path: args.importer
                }));

                onLoad({ namespace: 'setup.js', filter: /.*/ }, async args => ({
                    contents: await entryPoints[args.path].setup
                }));
                onLoad({ namespace: 'prepare.js', filter: /.*/ }, async args => ({
                    resolveDir: '/',
                    contents: 'export default [' + (entryPoints[args.path].prepare
                        ? 'require(' + JSON.stringify('discovery:' + entryPoints[args.path].prepare) + ')'
                        : '') + ']'
                }));
                onLoad({ namespace: 'extensions.js', filter: /.*/ }, async args => ({
                    resolveDir: '/',
                    contents: 'export default [' +
                        entryPoints[args.path].extensions
                            .map(fn => 'require(' + JSON.stringify('discovery:' + fn) + ')')
                            .join(',') +
                        ']'
                }));
                onLoad({ namespace: 'extensions.css', filter: /.*/ }, async args => ({
                    loader: 'css',
                    resolveDir: '/',
                    contents: entryPoints[args.path].extensions
                        .map(fn => '@import url(' + JSON.stringify(fn) + ');')
                        .join('\n')
                }));
            }
        }, {
            name: 'discovery-wrapper',
            setup({ onResolve, onLoad }) {
                onResolve({ filter: /^discovery:/ }, args => ({
                    namespace: 'discovery-wrapped-js',
                    path: args.path.replace(/^discovery:/, '')
                }));

                onLoad({ namespace: 'discovery-wrapped-js', filter: /.*/ }, args => ({
                    resolveDir: path.dirname(args.path),
                    contents: 'export default function(discovery) {\n' +
                        fs.readFileSync(args.path) +
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
