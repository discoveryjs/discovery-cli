const { build } = require('esbuild');

module.exports = async function(entryPoints, modules = {}, options = {}) {
    const res = await build({
        plugins: [{
            name: 'generated-module',
            setup(esbuild) {
                esbuild.onResolve({ filter: /^discovery:setup$/ }, args => ({
                    namespace: 'setup',
                    path: args.path.replace(/^discovery:/, '')
                }));
                esbuild.onResolve({ filter: /^discovery:/ }, args => ({
                    namespace: 'generated-module',
                    path: args.path.replace(/^discovery:/, '')
                }));

                esbuild.onLoad({ namespace: 'setup', filter: /.*/ }, async args => ({
                    contents: await modules[args.path]()
                }));
                esbuild.onLoad({ namespace: 'generated-module', filter: /.*/ }, async args => ({
                    resolveDir: '/',
                    contents: (await build({
                        banner: 'export default function(discovery) {',
                        stdin: {
                            resolveDir: '/',
                            contents: modules[args.path]()
                        },
                        footer: '}',
                        bundle: true,
                        write: false
                    })).outputFiles[0].contents
                }));
            }
        }],
        entryPoints: Array.isArray(entryPoints) ? entryPoints : [entryPoints],
        bundle: true,
        format: 'esm',
        define: {
            global: 'window'
        },
        write: false,
        ...options
    });

    return {
        content: res.outputFiles[0].contents
    };
};
