const fs = require('fs');
const path = require('path');
const mime = require('mime');
const csstree = require('css-tree');
const discoveryDir = require('./discovery-dir');

function resolvePath(ref, basepath) {
    if (/^\/node_modules\//.test(ref)) {
        basepath = discoveryDir;
    }

    return {
        basepath,
        ref,
        resolved: path.join(basepath, ref)
    };
}

function getValueFromStringOrRaw(node) {
    switch (node.type) {
        case 'String':
            return node.value.substring(1, node.value.length - 1);

        case 'Raw':
            return node.value;
    }

    return null;
}

function resolveFile(node, basepath) {
    let url;

    switch (node.type) {
        case 'String':
        case 'Raw':
            url = getValueFromStringOrRaw(node);
            break;

        case 'Url':
            url = getValueFromStringOrRaw(node.value);
            break;

        default:
            throw new Error('Unknown value type: ' + csstree.generate(node));
    }

    return resolvePath(url, basepath);
}

function inlineResource(uri, baseURI) {
    // do nothing if uri is already a dataURI resource
    if (/^data:/i.test(uri)) {
        return uri;
    }

    const filepath = resolvePath(uri, baseURI).resolved;
    const mimeType = mime.getType(filepath);
    let data = fs.existsSync(filepath)
        ? fs.readFileSync(filepath)
        : '';

    return 'data:' + mimeType + ';base64,' + data.toString('base64');
}

function processFile(filename) {
    const ast = csstree.parse(fs.readFileSync(filename, 'utf8'));

    csstree.walk(ast, {
        visit: 'Atrule',
        leave(node, item, list) {
            if (node.name === 'import') {
                const resolveResult = resolveFile(
                    node.prelude.children.first(),
                    path.dirname(filename)
                );

                try {
                    list.replace(item, processFile(resolveResult.resolved).children);
                } catch (e) {
                    console.error('ERROR on @import resolving');
                    console.error(JSON.stringify({ filename, ...resolveResult }, null, 4));
                    console.error();
                    console.error(e);
                    process.exit(1);
                }
            }
        }
    });

    csstree.walk(ast, {
        visit: 'Url',
        leave(node) {
            const url = getValueFromStringOrRaw(node.value);
            const inlined = inlineResource(url, path.dirname(filename));

            if (inlined !== url) {
                node.value = {
                    type: 'Raw',
                    value: inlined
                };
            }
        }
    });

    return ast;
}

module.exports = function(filename) {
    return Promise.resolve(csstree.generate(processFile(filename)));
};
