const path = require('path');
const fs = require('fs');
const mime = require('mime');
const bootstrap = require('./shared/bootstrap');
const utils = require('./shared/utils');
const gen = require('./shared/gen');
const ensureDir = require('./shared/ensure-dir');
const discoveryDir = require('./shared/discovery-dir');
const { createCacheDispatcher } = require('./shared/cache');
const staticSrc = path.join(__dirname, 'static');
const esbuild = require('esbuild');

function isRelatedToPath(pathname, dir, name) {
    return pathname.slice(0, dir.length) === dir
        ? `(${name})${pathname.slice(dir.length + 1)}`
        : false;
}

function relpath(pathname) {
    return (
        isRelatedToPath(pathname, discoveryDir, 'discovery') ||
        path.relative(process.cwd(), pathname)
    );
}

function writeFile(dest, content) {
    if (content.stream) {
        content = content.stream;
    }

    if (typeof content.pipe === 'function') {
        return new Promise((resolve, reject) =>
            content.pipe(fs.createWriteStream(ensureDir(dest)))
                .on('finish', resolve)
                .on('error', reject)
        ).then(() => utils.process(`Write ${relpath(dest)}`, () => {}));
    }

    return utils.process(`Write ${relpath(dest)}`, () => {
        fs.writeFileSync(ensureDir(dest), content);
    });
}

function selectAssets(modelConfig) {
    const view = modelConfig.view || {};
    const baseURI = view.basedir || view.base || '';

    return Array.isArray(view.assets)
        ? view.assets.map(fn => path.resolve(baseURI, fn))
        : [];
}

function convertToSingleFile(filepath, content, files) {
    const getFileContent = relpath => files.get(path.resolve(path.dirname(filepath), relpath));

    return content
        .replace(/<link rel="icon".+?>/g, m => {
            utils.println('Inline', m);
            return m.replace(/\s+href="(.+?)"/, (m, filepath) =>
                ` href="data:${
                    mime.getType(path.extname(filepath))
                };base64,${
                    getFileContent(filepath)
                }"`
            );
        })
        .replace(/<link rel="stylesheet".+?>/g, m => {
            const hrefMatch = m.match(/\s+href="(.+?)"/);

            return hrefMatch
                ? utils.println('Inline', m) || `<style>${getFileContent(hrefMatch[1])}</style>`
                : m;
        })
        .replace(/<script .+?>/g, m => {
            let scriptSrc = null;
            const newOpenTag = m.replace(/\s+src="(.+?)"/, (m, src) => (scriptSrc = src, ''));

            return scriptSrc
                ? utils.println('Inline', m) || newOpenTag + getFileContent(scriptSrc)
                : m;
        })
        .replace(new RegExp(`function ${utils.DATA_PLACEHOLDER}\\(\\){return.*?}\\(\\)`), () => {
            utils.println('Substitute data');
            return JSON.stringify(getFileContent('data.json'));
        });
}

module.exports = bootstrap(async function build(options, config, configFile) {
    const cacheDispatcher = createCacheDispatcher(config.models, { cachedir: options.cachedir });
    const outputDir = options.output;
    const outputFiles = new Map();
    const entryPoints = Object.create(null);
    const modelJs = fs.readFileSync(staticSrc + '/model.js');
    const modelCss = fs.readFileSync(staticSrc + '/model.css');
    const startTime = Date.now();
    const models = config.models || [];

    console.log(configFile
        ? `Load config from ${configFile}`
        : 'No config is used'
    );

    // check up models
    if (!models.length) {
        if (options.model) {
            // looks like a user mistake
            console.error(`  Model \`${options.model}\` is not found`);
            process.exit(2);
        }

        // model free mode
        utils.println('Models are not defined (model free mode is enabled)');

        models.push({});
    }

    for (const modelConfig of config.models) {
        const favicon = modelConfig.favicon || config.favicon;

        outputFiles.set(
            `${modelConfig.slug}/index.html`,
            gen['/model.html'](modelConfig, options, config)
        );
        outputFiles.set(
            `${modelConfig.slug}/favicon${path.extname(favicon)}`,
            fs.readFileSync(favicon)
        );

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

    if (config.mode === 'multi') {
        outputFiles.set(
            'index.html',
            gen['/index.html'](null, options, config)
        );
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

    await utils.process('Build bundles', () => esbuild.build({
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
        outdir: outputDir
    }).then(bundles => {
        for (const file of bundles.outputFiles) {
            const filepath = !/index\.(js|css)$/.test(file.path)
                ? file.path.replace(/\.(js|css)$/, '/model$&')
                : file.path;

            outputFiles.set(path.relative(outputDir, filepath), file.contents);
        }
    }));


    if (options.data) {
        await utils.section('Generate data', async () => {
            for (const modelConfig of models) {
                if (modelConfig.data) {
                    await utils.process(modelConfig.slug, async () => outputFiles.set(
                        `${modelConfig.slug}/data.json`,
                        await cacheDispatcher.read(modelConfig.slug).then(cache => cache
                            ? { stream: fs.createReadStream(cache.file) }
                            : gen['/data.json'](modelConfig, options)
                        )
                    ));
                } else {
                    utils.println('[NO DATA] ' + modelConfig.slug);
                }
            }
        });
    }

    if (options.singleFile) {
        await utils.process('Convert to single file', () => {
            const files = new Map([...outputFiles.entries()]);

            for (const [path, content] of files) {
                if (/\.html$/.test(path)) {
                    convertToSingleFile(path, content, files);
                } else {
                    outputFiles.delete(path);
                }
            }
        });
    }

    if (options.cleanup && fs.existsSync(options.output)) {
        await utils.process(`Clean up dest dir before write (${options.output})`, () =>
            fs.readdirSync(options.output).forEach(name => {
                const fullpath = path.join(options.output, name);

                if (fs.statSync(fullpath).isDirectory()) {
                    fs.rmdirSync(fullpath);
                } else {
                    fs.unlinkSync(fullpath);
                }
            })
        );
    }

    await utils.process(`Write files to dest (${outputDir})`, () => utils.silent(() => Promise.all(
        [...outputFiles.keys()].sort().map(async filepath =>
            writeFile(path.resolve(outputDir, filepath), await outputFiles.get(filepath))
        )
    )));

    console.log(`\nDONE 🎉  (in ${utils.prettyDuration(Date.now() - startTime)})`);
});
