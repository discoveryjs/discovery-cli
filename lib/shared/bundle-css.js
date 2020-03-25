const fs = require('fs');
const path = require('path');
const mime = require('mime');
const crypto = require('crypto');
const csstree = require('./_csstree'); // FIXME: temporary solution until css-tree release with onComment support
const discoveryDir = require('./discovery-dir');
const isolateRootPrefix = 'isolate-style-root:';

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

function isolateRules(rules, isolateName, isolateRoots) {
    const isIsolateRoot = node => node.type === 'ClassSelector' && isolateRoots.has(node.name);

    for (const rule of rules) {
        rule.prelude.children.forEach(selector => {
            if (!csstree.find(selector, isIsolateRoot)) {
                selector.children.prependData({ type: 'Combinator', name: ' ' });
            }
            selector.children.prependData({ type: 'ClassSelector', name: isolateName });
        });
    }
}

function linearAst(filename, context) {
    const content = fs.readFileSync(filename, 'utf8');
    const imports = [];
    const ast = csstree.parse(content, {
        onComment: comment => {
            const value = comment.trim();

            if (value === 'global-style') {
                context = { ...context, isolate: false };
            }

            if (value.startsWith(isolateRootPrefix)) {
                for (const name of value.slice(isolateRootPrefix.length).trim().split(/\s*,\s*/)) {
                    context.roots.add(name);
                }
            }
        }
    });

    csstree.walk(ast, {
        enter(node, item, list) {
            if (node.type === 'Atrule' && node.name === 'import') {
                const resolveResult = resolveFile(
                    node.prelude.children.first,
                    path.dirname(filename)
                );

                try {
                    imports.push({
                        list,
                        item,
                        ast: linearAst(resolveResult.resolved, context)
                    });
                    node.prelude = null;
                } catch (e) {
                    console.error('ERROR on @import resolving');
                    console.error(JSON.stringify({ filename, ...resolveResult }, null, 4));
                    console.error();
                    console.error(e);
                    process.exit(1);
                }
            } else if (node.type === 'Url') {
                const url = getValueFromStringOrRaw(node.value);
                const inlined = inlineResource(url, path.dirname(filename));

                if (inlined !== url) {
                    node.value = {
                        type: 'Raw',
                        value: inlined
                    };
                }
            } else if (node.type === 'Rule' && context.isolate) {
                context.rules.push(node);
            }
        }
    });

    if (context.hash !== null) {
        // use csstree.generate() instead of file content
        // to reduce whitespaces and comments effect on hash
        context.hash.update(csstree.generate(ast));
    }

    // replace @import's for its content
    for (const { list, item, ast } of imports) {
        list.replace(item, ast.children);
    }

    return ast;
}

module.exports = function(filename, options) {
    const { isolate, isolateRoots = [] } = options || {};
    const hash = isolate && typeof isolate !== 'string' ? crypto.createHash('sha1') : null;
    const roots = new Set(isolateRoots);
    const rules = [];
    const ast = linearAst(filename, {
        isolate: Boolean(isolate),
        hash,
        rules,
        roots
    });
    const isolateName = hash !== null
        ? 'i' + hash.digest('hex')
        : (typeof isolate === 'string' ? isolate : null);

    if (roots.size > 0) {
        ast.children.prependData({
            type: 'Comment',
            value: isolateRootPrefix + [...roots].join(',')
        });
    }

    if (isolateName !== null) {
        isolateRules(rules, isolateName, roots);
    }

    return Promise.resolve({
        isolate: isolateName,
        content: csstree.generate(ast)
    });
};
