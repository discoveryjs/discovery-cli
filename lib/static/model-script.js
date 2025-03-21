import fs from 'node:fs';
import path from 'node:path';
import { isReadable, Readable } from 'node:stream';
import setup from 'discovery-cli:setup-script';
import modelSetup from 'discovery-cli:model-setup';
import extensions from 'discovery-cli:extensions-script';
import encodings from 'discovery-cli:encodings';
import { Model } from '@discoveryjs/discovery/src/lib-script.js';

function chain(state, value = state.then()) {
    return Object.assign(Promise.resolve(value), {
        query(query, args) {
            const nextState = state.then(async ({ host, data, context }) => ({
                host,
                data: await host.query(query, data, { ...context, args }),
                context
            }));
            return chain(nextState, nextState.then(state => state.data));
        },
        context(query, args) {
            const nextState = state.then(async ({ host, data, context }) => ({
                host,
                data,
                context: await host.query(query, data, { ...context, args })
            }));
            return chain(nextState, nextState.then(state => state.context));
        },
        render(config, args) {
            const nextState = state.then(async ({ host, data, context }) => {
                const tree = await host.textView.render(null, config, data, { ...context, args });
                return await host.textView.serialize(tree);
                // return { host, data, context };
            });

            return chain(nextState);
        },
        renderToConsole(config, args) {
            const nextState = state.then(async ({ host, data, context }) => {
                const tree = await host.textView.render(null, config, data, { ...context, args });
                const result = await host.textView.serialize(tree);

                console.log(result.text);

                return result;
            });

            return chain(nextState);
        }
    });
}

function resourceFromPath(filepath) {
    if (typeof filepath !== 'string') {
        return;
    }

    try {
        const absFilename = path.resolve(process.cwd(), filepath);
        const stat = fs.statSync(absFilename);

        return {
            type: 'file',
            name: path.basename(absFilename),
            path: absFilename,
            size: stat.size,
            createdAt: stat.ctime
        };
    } catch {}
}

class ScriptModel extends Model {
    loadDataFromStream(stream, options) {
        return super.loadDataFromStream(
            isReadable(stream) ? Readable.toWeb(stream) : stream,
            typeof stream.path === 'string' && !options?.resource
                ? { ...options, resource: resourceFromPath(stream.path) }
                : options
        );
    }
    loadDataFromFile(filename, options) {
        const absFilename = path.resolve(process.cwd(), filename);
        return this.loadDataFromStream(fs.createReadStream(absFilename), {
            ...options,
            resource: resourceFromPath(absFilename)
        });
    }
    queryChain(query = '') {
        return chain(Promise.resolve({
            host: this,
            data: this.data,
            context: this.getContext()
        })).query(query);
    }
}

export const model = new ScriptModel({
    encodings,
    extensions,
    setup: modelSetup,
    context: { model: setup.model }
});
export const raw = new ScriptModel({
    encodings
});

