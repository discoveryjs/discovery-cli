const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { pipeline, promises: streamPromises } = require('stream');
const bootstrap = require('./shared/bootstrap');
const utils = require('./shared/utils');
const gen = require('./shared/gen');
const ensureDir = require('./shared/ensure-dir');
const makeBundle = require('./shared/bundle');
const { createCacheDispatcher } = require('./shared/cache');
const { isHeaderAcceptable: isJsonxl } = require('./tmp/jsonxl-snapshot9');
const ChunkedContent = require('./shared/chunked-content');
const createHtmlRawTextDataPrinter = require('./shared/html-raw-text-data-printer');
const createHtmlBase64DataPrinter = require('./shared/html-base64-data-printer');

function relpath(pathname) {
    return path.relative(process.cwd(), pathname);
}

function writeFile(dest, content, parallel) {
    if (content.stream) {
        content = content.stream;
    }

    if (typeof content.pipe === 'function') {
        const promisifiedStream = new Promise((resolve, reject) =>
            content
                .on('error', reject)
                .pipe(fs.createWriteStream(ensureDir(dest)))
                .on('finish', resolve)
                .on('error', reject)
        );

        return parallel
            ? promisifiedStream.then(() => utils.process(`Write ${relpath(dest)}`, () => {}))
            : utils.process(`Write ${relpath(dest)}`, () => promisifiedStream);
    }

    return utils.process(`Write ${relpath(dest)}`, () => {
        fs.writeFileSync(ensureDir(dest), content);
    });
}

function createBase64DataPrinter(maxChunkSize, binary, compress) {
    return createHtmlBase64DataPrinter(
        maxChunkSize,
        compress,
        // type
        `discovery/${binary ? 'binary-' : ''}${compress ? 'compressed-' : ''}data-chunk`,
        // onDataChunk
        `discoveryLoader.push(chunk, ${binary}, ${compress})`
    );
}

function createRawTextDataPrinter(maxChunkSize) {
    return createHtmlRawTextDataPrinter(
        maxChunkSize,
        // type
        'discovery/data-chunk',
        // onDataChunk
        'discoveryLoader.push(chunk, false, false)'
    );
}

function streamDataToHtml(resource, compressData) {
    if (!resource || !resource.stream) {
        return '';
    }

    return pipeline(
        resource.stream,
        async function* (source) {
            let printer = null;
            let encodedSize = 0;

            yield `\n<script>discoveryLoader.start(${JSON.stringify({
                type: 'build',
                size: resource.size,
                createdAt: resource.createdAt
            })})</script>`;

            for await (let sourceChunk of source) {
                if (printer === null) {
                    const isBinary = isJsonxl(sourceChunk);

                    if (isBinary || compressData) {
                        printer = createBase64DataPrinter(8 * 64 * 1024, isBinary, compressData); // 512Kb
                    } else {
                        printer = createRawTextDataPrinter(16 * 64 * 1024); // 1Mb

                        // work with strings rather than Buffers
                        sourceChunk = sourceChunk.toString('utf8');
                        source.setEncoding('utf8');
                    }
                }

                for (const htmlChunk of printer.push(sourceChunk)) {
                    encodedSize += htmlChunk.length;
                    yield htmlChunk;
                }
            }

            for (const htmlChunk of printer.finish()) {
                encodedSize += htmlChunk.length;
                yield htmlChunk;
            }

            yield '\n<script>discoveryLoader.finish(' + encodedSize + ')</script>';
        },
        function() {
            // pipeline() expects a callback as the last parameter, doesn't work otherwise
        }
    );
}

async function convertToSingleFile(content, files) {
    const getFileContent = relpath => files.get(relpath)?.content;

    return new ChunkedContent(await content)
        .replace(/<link rel="icon".+?>/g, m => {
            utils.println('Inline', m);

            return m.replace(/\s+href="(.+?)"/, (m, faviconpath) =>
                ` href="${utils.dataUriForPath(faviconpath, getFileContent(faviconpath).toString('base64'))}"`
            );
        })
        .replace(/<link rel="stylesheet".+?>/g, m => {
            const hrefMatch = m.match(/\s+href="(.+?)"/);

            return hrefMatch
                ? utils.println('Inline', m) || ['<style>', getFileContent(hrefMatch[1]), '</style>`']
                : m;
        })
        .replace(/<link rel="discovery-stylesheet".+?>/g, m => {
            const hrefMatch = m.match(/\s+href="(.+?)"/);

            return hrefMatch
                ? utils.println('Inject', m) || [`<style type="discovery/style" src="${hrefMatch[1]}">`, getFileContent(hrefMatch[1]), '</style>']
                : m;
        })
        .replace(/<link rel="(?:module)?preload".+?>/g, m => {
            // remove preload links since all the resources will be embedded into the HTML page
            return utils.println('Remove', m) || '';
        })
        .replace(/<script .+?>/g, m => {
            let scriptSrc = null;
            const newOpenTag = m
                .replace(/\s+src="(.+?)"/, (m, src) => (scriptSrc = src, ''))
                .replace(/\s+type="module"/, '');

            return scriptSrc
                ? utils.println('Inline', m) || [newOpenTag, getFileContent(scriptSrc)]
                : m;
        });
}

async function relinkAssetRefs(content, files, entryPointPath) {
    const relinkAttr = attr => str => str.replace(new RegExp(`\\b${attr}="(.+?)"`), (_, respath) =>
        `${attr}="${path.relative(entryPointPath, files.get(respath).outputPath).replace(/^(\.{0,2}\/)?/, m => m || './')}"`
    );

    return new ChunkedContent(await content)
        .replace(/<link rel="icon".+?>/g, relinkAttr('href'))
        .replace(/<link rel="stylesheet".+?>/g, relinkAttr('href'))
        .replace(/<link rel="discovery-stylesheet".+?>/g, relinkAttr('href'))
        .replace(/<link rel="(?:module)?preload".+?>/g, relinkAttr('href'))
        .replace(/<script .+?>/g, relinkAttr('src'));
}

class OutputFiles extends Map {
    constructor(...args) {
        super(...args);
        this.keySlugs = new Map();
    }
    set(key, value, slug) {
        if (this.has(key)) {
            throw new Error(`Can't add "${key}" asset for "${slug}" model since path already used by "${this.keySlugs.get(key)}" model`);
        }

        this.keySlugs.set(key, slug || '[index]');

        return super.set.call(this, key, value);
    }
}

async function build(options, config, configFile) {
    const singleEntryMode = config.mode === 'modelfree' || config.mode === 'single';

    if (!options.entryNames || !options.assetNames) {
        const entryNames = options.entryNames || (singleEntryMode ? 'index' : '[slug]/index');
        const assetNames = options.assetNames || path.join(
            path.dirname(entryNames),
            singleEntryMode || path.dirname(entryNames).includes('[slug]') ? '[name]' : '[slug]/[name]'
        );

        options = {
            ...options,
            entryNames,
            assetNames
        };
    }

    const cacheDispatcher = createCacheDispatcher(config.models, { configFile, ...options });
    const suppressedFailures = [];
    const outputDir = options.output;
    const outputFiles = new OutputFiles();
    const entryPoints = new Map();
    const models = config.models || [];
    const skippedModels = [];
    const extenalDataAssets = [];
    const modelAssets = new Map();
    const addModelAsset = (slug, filename, content) => modelAssets.get(slug).set(filename, {
        outputPath: buildAssetName(entryPoints.get(slug).outputPath, slug, filename),
        content
    });
    const buildAssetName = (entryName, slug, filename) => path.join(
        path.dirname(entryName),
        utils.buildAssetNameByPattern(options.assetNames, entryName, { slug, ...utils.nameExt(filename) })
    );
    const esbuildConfig = {
        minify: typeof options.minify === 'boolean' ? options.minify : true,
        sourcemap: options.singleFile && options.sourcemap ? 'inline' : options.sourcemap
    };

    utils.println(configFile
        ? `Load config from ${configFile}`
        : 'No config is used'
    );

    utils.println();
    utils.println('Build mode: ' + chalk.yellow(config.mode));
    utils.println('Entry names pattern: ' + chalk.yellow(options.entryNames));
    utils.println('Asset names pattern: ' + chalk.yellow(options.assetNames));
    utils.println();

    if (!singleEntryMode && (!/\[slug\]/.test(options.entryNames) || !/\[slug\]/.test(options.assetNames))) {
        console.error('ERROR: Entry and asset name patterns in "multi" build mode must include "[slug]"');
        process.exit(2);
    }

    if (!/\[name\]/.test(options.assetNames)) {
        console.error('ERROR: Entry name patterns must include "[name]"');
        process.exit(2);
    }

    // check up models
    if (!models.length) {
        if (options.model) {
            // looks like a user mistake
            console.error(`  Model \`${options.model}\` is not found`);
            process.exit(2);
        }

        // model free mode
        utils.println('Models are not defined (model free mode is enabled)');

        models.push({ slug: 'modelfree' });
        config = {
            ...config,
            models
        };
    }

    for (const modelConfig of models) {
        const favicon = modelConfig.favicon || config.favicon;
        const entryPointPath = utils.buildEntryNameByPattern(options.entryNames, {
            slug: modelConfig.slug
        });

        entryPoints.set(modelConfig.slug, {
            outputPath: entryPointPath,
            content: gen['/model.html'](modelConfig, options, config)
        });

        modelAssets.set(modelConfig.slug, new Map());
        addModelAsset(
            modelConfig.slug,
            `favicon${path.extname(favicon)}`,
            fs.readFileSync(favicon)
        );
    }

    if (config.mode === 'multi') {
        const favicon = config.favicon;
        const entryPointPath = 'index.html';

        entryPoints.set('', {
            outputPath: entryPointPath,
            content: gen['/index.html'](null, options, config)
        });

        modelAssets.set('', new Map());
        addModelAsset(
            '',
            `favicon${path.extname(favicon)}`,
            fs.readFileSync(favicon)
        );
    }

    let buildResult = await utils.process('Build bundles', () =>
        makeBundle(config, options, esbuildConfig, { cacheDispatcher })
    );

    if (options.data) {
        await utils.section('Generate data', async () => {
            for (const modelConfig of models) {
                if (modelConfig.data) {
                    await utils.process(modelConfig.slug, async () => {
                        try {
                            const dataTempFilename = cacheDispatcher.genModelCacheTempFilename(modelConfig.slug);
                            let asset = await cacheDispatcher.read(modelConfig.slug);

                            if (!asset) {
                                const genAsset = await gen['/model.data'](modelConfig, options);

                                fs.mkdirSync(path.dirname(dataTempFilename), { recursive: true });
                                await streamPromises.pipeline(
                                    genAsset.stream,
                                    fs.createWriteStream(dataTempFilename)
                                );

                                asset = {
                                    ...genAsset,
                                    file: dataTempFilename
                                };
                            }

                            asset.stream = fs.createReadStream(dataTempFilename);

                            const closingAsset = options.singleFileData === 'both'
                                ? { ...asset, stream: fs.createReadStream(asset.file) }
                                : asset;

                            addModelAsset(
                                modelConfig.slug,
                                'model.data',
                                asset
                            );

                            if (['external', 'both'].includes(options.singleFileData)) {
                                extenalDataAssets.push([
                                    modelAssets.get(modelConfig.slug).get('model.data').outputPath,
                                    closingAsset
                                ]);
                            }

                            // delete temporary data files on stream closing, otherwise they will be deleted
                            // by the cache dispatcher in 1 hour
                            closingAsset.stream
                                .on('close', () => fs.rmSync(asset.file));
                        } catch (error) {
                            if (options.excludeModelOnDataFail) {
                                console.error(chalk.bgRed.white('ERROR') + '\n' + chalk.red(error));
                                console.warn(chalk.yellow(`Model "${modelConfig.slug}" failed to build its data. The build will continue, but the model will be excluded from the result because --exclude-model-on-data-fail is enabled.`));
                                suppressedFailures.push(`Model "${modelConfig.slug}" failed to build its data`);
                                skippedModels.push(modelConfig);
                            } else {
                                throw error;
                            }
                        }
                    });
                } else {
                    utils.println(`${modelConfig.slug} <no data>`);
                }
            }
        });
    }

    // take action when some models fail to build
    if (skippedModels.length > 0) {
        for (const modelConfig of skippedModels) {
            entryPoints.delete(modelConfig.slug);
            modelAssets.delete(modelConfig.slug);
        }

        buildResult = await utils.process('Rebuild bundles without failed models', () =>
            makeBundle({
                ...config,
                models: models.filter(model => !skippedModels.includes(model))
            }, options, esbuildConfig, { cacheDispatcher })
        );
        console.log('  Excluded models:', skippedModels.map(model => chalk.red(model.slug)).join(', '));
    }

    // fullfil outputFiles
    for (const file of buildResult.outputFiles) {
        const relpath = path.relative(outputDir, file.path);
        const { slug, filename } = relpath.match(/^(?:(?<slug>[^\/]+)\/)?(?<filename>.+)$/)?.groups;
        const content = Buffer.from(file.contents);

        if (slug) {
            addModelAsset(slug, filename, content);
        } else {
            modelAssets.get('').set(filename, {
                outputPath: filename,
                content
            });
        }
    }

    // bake html files
    if (options.singleFile) {
        await utils.section('Convert to single file', async () => {
            // add external model data assets if any (used when --single-file-data is "both")
            for (const [outputPath, content] of extenalDataAssets) {
                outputFiles.set(outputPath, content);
            }

            // add entry points (html files) but with everything inlined
            for (const [slug, { outputPath, content }] of entryPoints) {
                outputFiles.set(outputPath, await utils.section(outputPath, async () => {
                    const files = modelAssets.get(slug);
                    const chunkedContent = await convertToSingleFile(content, files);

                    if (!options.singleFileData || ['inline', 'both'].includes(options.singleFileData)) {
                        const dataContent = files.get('model.data')?.content;

                        chunkedContent.replace(/$/, () =>
                            streamDataToHtml(dataContent, options.dataCompression)
                        );
                    }

                    return chunkedContent;
                }));
            }
        });
    } else {
        await utils.section('Relink asset references', async () => {
            for (const [slug, assets] of modelAssets) {
                for (const { outputPath, content } of assets.values()) {
                    outputFiles.set(outputPath, content, slug);
                }
            }

            for (const [slug, { outputPath, content }] of entryPoints) {
                outputFiles.set(outputPath, await utils.section(outputPath, () =>
                    relinkAssetRefs(content, modelAssets.get(slug), path.dirname(outputPath))
                ));
            }
        });
    }

    if (options.clean && fs.existsSync(options.output)) {
        await utils.process(`Clean up dest dir before write (${options.output})`, () =>
            fs.readdirSync(options.output).forEach(name => {
                const fullpath = path.join(options.output, name);

                if (fs.statSync(fullpath).isDirectory()) {
                    (fs.rmSync || fs.rmdirSync)(fullpath, { recursive: true });
                } else {
                    fs.unlinkSync(fullpath);
                }
            })
        );
    }

    return {
        files: outputFiles,
        suppressedFailures: suppressedFailures.length ? suppressedFailures : false
    };
}

module.exports = bootstrap(async function(options, config, configFile) {
    const startTime = Date.now();
    const outputDir = options.output;
    const { files, suppressedFailures } = await build(options, config, configFile);
    const outputFilenames = [...files.keys()].sort();

    await utils.section(`Write files to dest (${outputDir})`, async () => {
        for (const filepath of outputFilenames) {
            await writeFile(path.resolve(outputDir, filepath), files.get(filepath));
        }
    });

    console.log(`\nDONE 🎉  (in ${utils.prettyDuration(Date.now() - startTime)})`);

    return { files, suppressedFailures };
});

module.exports.build = build;
