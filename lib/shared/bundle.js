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
    const files = Object.create(null);
    const entryPoints = [];

    if (mode !== 'index-only') {
        for (const modelConfig of config.models) {
            const jsRef = `${modelConfig.slug}/${modelConfig.slug}.js`;
            files[`${jsRef}`] = () => fs.readFileSync(staticSrc + '/model.js');
            files[`${modelConfig.slug}/setup.js`] = () => gen['/gen/setup.js'](modelConfig, options, config);
            files[`${modelConfig.slug}/prepare.js`] = () => modelConfig.prepare;
            files[`${modelConfig.slug}/extensions.js`] = () => selectAssets(modelConfig)
                .filter(fn => /\.[tj]sx?/.test(path.extname(fn)));

            const cssRef = `${modelConfig.slug}/${modelConfig.slug}.css`;
            files[`${cssRef}`] = () => fs.readFileSync(staticSrc + '/model.css'),
            files[`${modelConfig.slug}/extensions.css`] = () => selectAssets(modelConfig)
                .filter(fn => path.extname(fn) === '.css');

            entryPoints.push(jsRef, cssRef);
        }
    }

    if (mode !== 'model-only' && config.mode === 'multi') {
        const jsRef = 'index/index.js';
        files[`${jsRef}`] = () => fs.readFileSync(staticSrc + '/index.js');
        files['index/setup.js'] = () => gen['/gen/setup.js'](gen, options, config);
        files['index/extensions.js'] = () => [];

        const cssRef = 'index/index.css';
        files[`${cssRef}`] = () => fs.readFileSync(staticSrc + '/index.css');
        files['index/extensions.css'] = () => [];

        entryPoints.push(jsRef, cssRef);
    }

    return esbuild.build({
        plugins: [{
            name: 'discovery-cli',
            setup({ onResolve, onLoad }) {
                // entry points
                onResolve({ namespace: '', filter: /.*/ }, args => args.namespace !== '' ? null : ({
                    namespace: 'discovery-cli',
                    path: args.path
                }));

                // entry point imports
                onResolve({ namespace: 'discovery-cli', filter: /^discovery-cli:(setup|prepare|extensions)$/ }, args => {
                    return {
                        namespace: 'discovery-cli',
                        path: path.dirname(args.importer) + '/' + args.path.split(':')[1] + path.extname(args.importer)
                    };
                });

                onLoad({ namespace: 'discovery-cli', filter: /.*/ }, async args => {
                    const filename = path.basename(args.path);
                    const getContents = files[args.path];
                    const contents = typeof getContents === 'function' ? await getContents() : null;

                    switch (filename) {
                        case path.dirname(args.path) + '.js': return {
                            resolveDir: staticSrc,
                            contents
                        };

                        case 'setup.js': return {
                            contents
                        };

                        case 'prepare.js': return {
                            resolveDir: '/',
                            contents: 'export default [\n' + (contents
                                ? '    require(' + JSON.stringify(contents + ':discovery') + ')'
                                : '') + '\n]'
                        };

                        case 'extensions.js': return {
                            resolveDir: '/',
                            contents: 'export default [\n' +
                                contents
                                    .map(fn => '    require(' + JSON.stringify(fn + ':discovery') + ')')
                                    .join(',\n') +
                                '\n]'
                        };

                        case path.dirname(args.path) + '.css': return {
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
            setup({ onLoad }) {
                onLoad({ filter: /:discovery$/ }, args => ({
                    resolveDir: path.dirname(args.path),
                    contents: 'export default function(discovery) {\n' +
                        fs.readFileSync(args.path.replace(/:discovery$/, '')) +
                    '\n}'
                }));
            }
        }],
        entryPoints,
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
