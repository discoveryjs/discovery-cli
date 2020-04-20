// Fork of https://github.com/Faleij/json-stream-stringify
const { Readable } = require('stream');
const PrimitiveType = 1;
const PromiseType = 2;
const ArrayType = 3;
const ObjectType = 4;
const ReadableStringType = 5;
const ReadableObjectType = 6;

function isReadableStream(value) {
    return (
        typeof value.pipe === 'function' &&
        // value.readable !== false &&
        typeof value._read === 'function' &&
        typeof value._readableState === 'object'
    );
}

function getType(value) {
    if (value !== null && typeof value === 'object') {
        if (typeof value.then === 'function') {
            return PromiseType;
        }

        if (isReadableStream(value)) {
            return value._readableState.objectMode ? ReadableObjectType : ReadableStringType;
        }

        if (Array.isArray(value)) {
            return ArrayType;
        }

        return ObjectType;
    }

    return PrimitiveType;
}

function quoteString(string) {
    return JSON.stringify(string);
}

function primitiveToString(value) {
    switch (typeof value) {
        case 'string':
            return quoteString(value);

        case 'number':
            return Number.isFinite(value) ? String(value) : 'null';

        case 'boolean':
            return String(value);

        case 'undefined':
        case 'object':
            return 'null';

        default:
            // This should never happen, I can't imagine a situation where this executes.
            // If you find a way, please open a ticket or PR
            throw new Error(`Unknown type "${typeof value}". Please file an issue!`);
    }
}

function processPush() {
    this._push(this._stack.value);
    this.removeFromStack();
}

function processObjectEntry(key) {
    const current = this._stack;

    if (!current.first) {
        this._push(',');
    } else {
        current.first = false;
    }

    if (this.space) {
        this._push(`\n${this.space.repeat(this.depth)}${quoteString(key)}: `);
    } else {
        this._push(`${quoteString(key)}:`);
    }
}

function processObject() {
    const current = this._stack;

    // when no keys left, remove obj from stack
    if (current.index === current.keys.length) {
        this.removeFromStack();
        return;
    }
    const key = current.keys[current.index];

    this.processValue(key, current.value[key], processObjectEntry);
    current.index += 1;
}

function processArrayItem(index) {
    if (index !== '0') {
        this._push(',');
    }

    if (this.space) {
        this._push(`\n${this.space.repeat(this.depth)}`);
    }
}

function processArray() {
    const current = this._stack;

    if (current.index === current.value.length) {
        this.removeFromStack();
        return;
    }

    this.processValue(String(current.index), current.value[current.index], processArrayItem);
    current.index += 1;
}

function createStreamReader(fn) {
    return function() {
        const current = this._stack;
        const stream = current.value;

        // console.log('readStream', { readable: current.readable, _awaiting: this._awaiting })
        if (current.readable) {
            let dataRead = false;
            let data;

            while ((data = stream.read()) !== null) {
                fn.call(this, data, current);
                dataRead = true;
                current.first = false;
                if (this._stack !== current) {
                    return;
                }
            }

            if (!dataRead && current.first) {
                this.removeFromStack();
            } else {
                this.await();
                current.readable = false;
            }
        } else {
            this.await();
        }
    };
}

const processReadableObject = createStreamReader(function(data, current) {
    this.processValue(String(current.index), data, processArrayItem);
    current.index += 1;
});

const processReadableString = createStreamReader(function(data) {
    this._push(data);
});

function normalizeReplacer(replacer) {
    if (typeof replacer === 'function') {
        return replacer;
    }

    if (Array.isArray(replacer)) {
        const whitelist = new Set(replacer
            .map(item => typeof item === 'string' || typeof item === 'number' ? String(item) : null)
            .filter(item => typeof item === 'string')
        );

        whitelist.add('');

        return (key, value) => whitelist.has(key) ? value : undefined;
    }

    return null;
}

function normalizeSpace(space) {
    if (typeof space === 'number') {
        if (!Number.isFinite(space) || space < 1) {
            return false;
        }

        return ' '.repeat(Math.min(space, 10));
    }

    if (typeof space === 'string') {
        return space.slice(0, 10) || false;
    }

    return false;
}

class JsonStringifyStream extends Readable {
    constructor(value, replacer, space) {
        super({});

        this.replacer = normalizeReplacer(replacer);
        this.space = normalizeSpace(space);
        this.depth = 0;
        this.error = null;
        this.startTime = Date.now();
        this.visited = new WeakSet();

        this._stack = null;
        this._processing = false;
        this._awaiting = 0;
        this._readSize = 0;
        this._ended = false;

        this.processValue('', value, () => {});
    }

    processValue(key, value, callback) {
        if (value && typeof value.toJSON === 'function') {
            value = value.toJSON();
        }

        if (this.replacer !== null) {
            value = this.replacer.call(null, key, value);  // FIXME: `this` should be current value
        }

        if (typeof value === 'function' || typeof value === 'symbol') {
            value = undefined;
        }

        let type = getType(value);

        // check for circular structure
        if (type !== PrimitiveType && this.visited.has(value)) {
            this.abort(new Error('Converting circular structure to JSON'));
            return;
        }

        switch (type) {
            case PrimitiveType:
                if (callback !== processObjectEntry || value !== undefined) {
                    callback.call(this, key);
                    this._push(primitiveToString(value));
                }
                break;

            case PromiseType:
                this.await();

                value
                    .then(resolved => {
                        this.processValue(key, resolved, callback);
                        this.continue();
                    })
                    .catch(error => {
                        this.abort(error);
                    });
                break;

            case ObjectType:
                callback.call(this, key);

                const keys = Object.keys(value);

                if (keys.length === 0) {
                    this._push('{}');
                    return;
                }

                this.visited.add(value);
                this._push('{');
                this._stack = {
                    handler: processObject,
                    value,
                    keys,
                    index: 0,
                    first: true,
                    prev: {
                        handler: processPush,
                        value: this.space ? '\n' + this.space.repeat(this.depth) + '}' : '}',
                        prev: this._stack
                    }
                };
                this.depth += 1;
                break;

            case ArrayType:
                callback.call(this, key);

                if (value.length === 0) {
                    this._push('[]');
                    return;
                }

                this.visited.add(value);
                this._push('[');
                this._stack = {
                    handler: processPush,
                    value: this.space ? '\n' + this.space.repeat(this.depth) + ']' : ']',
                    prev: this._stack
                };
                this._stack = {
                    handler: processArray,
                    value,
                    index: 0,
                    prev: this._stack
                };
                this.depth += 1;
                break;

            case ReadableStringType:
            case ReadableObjectType:
                callback.call(this, key);

                if (type === ReadableObjectType) {
                    this._push('[');
                    this._stack = {
                        handler: processPush,
                        value: this.space ? '\n' + this.space.repeat(this.depth) + ']' : ']',
                        prev: this._stack
                    };
                    this.depth += 1;
                }

                if (value._readableState.ended) {
                    return this.abort(new Error('Readable Stream has ended before it was serialized. All stream data have been lost'));
                } else if (value._readableState.flowing) {
                    return this.abort(new Error('Readable Stream is in flowing mode, data may have been lost. Trying to pause stream.'));
                }

                const self = this._stack = {
                    handler: type === ReadableObjectType ? processReadableObject : processReadableString,
                    value,
                    readable: false,
                    ended: false,
                    index: 0,
                    prev: this._stack
                };

                this.await();
                value.pause();
                value.once('error', (err) => this.abort(err));
                value.on('readable', () => {
                    // console.log('readable', self.readable);
                    self.readable = true;
                    self.first = true;
                    if (this._stack === self) {
                        this.continue();
                    }
                    // this.processStackTopItem();
                });
                break;
        }
    }

    removeFromStack() {
        const { handler, value } = this._stack;

        if (handler === processObject || handler === processArray || handler === processReadableObject) {
            this.visited.delete(value);
            this.depth -= 1;
        }

        this._stack = this._stack.prev;
    }

    await() {
        // console.log('await()', this._awaiting);
        this._processing = false;
        this._awaiting++;
    }

    continue() {
        // console.log('continue()', this._awaiting);
        if (this._awaiting > 0) {
            this._awaiting--;
            if (this._awaiting === 0) {
                this.push();
                this.processStackTopItem();
            }
        }
    }

    abort(error) {
        this.error = error;
        this._stack = null;
        this._awaiting = 0;
        this._processing = false;
        this._ended = true;

        process.nextTick(() => {
            this.emit('error', error);
            this.push(null);
        });
    }

    processStackTopItem(size) {
        if (this._processing || this._awaiting || this._ended) {
            return;
        }

        try {
            this._processing = true;

            while (this._stack !== null) {
                this._stack.handler.call(this, size);

                if (!this._processing) {
                    return;
                }
            }

            this._processing = false;
        } catch (error) {
            this.abort(error);
            return;
        }

        // console.log('Serialized in', Date.now() - this.startTime);
        if (!this._ended) {
            this._stack = null;
            this._ended = true;
            this._push(null);
        }
    }

    _push(data) {
        this.push(data);

        if (data !== null) {
            this._readSize -= data.length;

            if (this._readSize <= 0) {
                this._processing = false;
            }
        }
    }

    _read(size) {
        this._readSize = size || this.readableHighWaterMark;
        this.processStackTopItem(size);
    }

    path() {
        const path = [];
        let cursor = this._stack;

        while (cursor !== null)  {
            const { key, index } = cursor;
            const v = key || index;

            if (v || v === 0) {
                path.push(v);
            }
        }

        return path;
    }
}

module.exports = function createJsonStringifyStream(value, replacer, spaces) {
    return new JsonStringifyStream(value, replacer, spaces);
};
