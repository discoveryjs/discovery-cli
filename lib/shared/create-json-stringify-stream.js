// Fork of https://github.com/Faleij/json-stream-stringify
const { Readable } = require('stream');
const PrimitiveType = 1;
const PromiseType = 2;
const ArrayType = 3;
const ObjectType = 4;
const ReadableStringType = 5;
const ReadableObjectType = 6;
const noop = () => {};

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

    if (current.firstEntry) {
        current.firstEntry = false;
    } else {
        this._push(',');
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
        const data = current.value.read();

        if (data !== null) {
            current.firstRead = false;
            fn.call(this, data, current);
        } else {
            if (current.firstRead) {
                this.removeFromStack();
            } else {
                current.firstRead = true;
                current.awaiting = true;
            }
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
        this.buffer = null;
        this.bufferOffset = 0;

        this._processing = false;
        this._ended = false;
        this._readSize = 0;
        this._stack = {
            handler: () => {
                this.removeFromStack();
                this.processValue('', value, noop);
            },
            prev: null
        };
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
                this._stack = {
                    handler: noop,
                    awaiting: true,
                    prev: this._stack
                };

                value
                    .then(resolved => {
                        this.removeFromStack();
                        this.processValue(key, resolved, callback);
                        this.processStackTopItem();
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
                    firstEntry: true,
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

                if (value.readableEnded) {
                    return this.abort(new Error('Readable Stream has ended before it was serialized. All stream data have been lost'));
                } if (value.readableFlowing) {
                    return this.abort(new Error('Readable Stream is in flowing mode, data may have been lost. Trying to pause stream.'));
                }

                const self = this._stack = {
                    handler: type === ReadableObjectType ? processReadableObject : processReadableString,
                    value,
                    awaiting: !value.readable || value.readableLength === 0,
                    firstRead: true,
                    index: 0,
                    prev: this._stack
                };

                value.once('error', (err) => this.abort(err));
                value.on('readable', () => {
                    if (self.awaiting) {
                        self.awaiting = false;

                        if (this._stack === self) {
                            this.processStackTopItem();
                        }
                    }
                });
                value.on('end', () => {
                    self.awaiting = false;
                    this.processStackTopItem();
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

    abort(error) {
        this.error = error;
        this._stack = null;
        this._processing = false;
        this._ended = true;

        process.nextTick(() => {
            this.buffer = null;
            this.emit('error', error);
            this.push(null);
        });
    }

    processStackTopItem(size) {
        if (this._processing || this._ended) {
            return;
        }

        try {
            this._processing = true;

            while (this._stack !== null && !this._stack.awaiting) {
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
        if (!this._stack && !this._ended) {
            this._stack = null;
            this._ended = true;
            if (this.bufferOffset > 0) {
                this.push(this.buffer.slice(0, this.bufferOffset)); // flush buffer
            }
            this.push(null);
            this.buffer = null;
        }
    }

    _push(data) {
        if (data !== null) {
            const max = this.bufferOffset + this._readSize;

            // prevent physical buffer overflow
            if (data.length > max) {
                this._stack = {
                    handler: processPush,
                    value: data.slice(max),
                    prev: this._stack
                };
                data = data.slice(0, max);
            }

            // write to buffer
            this.bufferOffset += typeof data === 'string'
                ? this.buffer.write(data, this.bufferOffset)
                : data.copy(this.buffer, this.bufferOffset);

            // check logical buffer overflow
            if (this.bufferOffset < this._readSize) {
                return;
            }

            // flush buffer
            data = Uint8Array.prototype.slice.call(this.buffer, 0, this._readSize);
            this.buffer.copy(this.buffer, 0, this._readSize, this.bufferOffset);
            this.bufferOffset -= this._readSize;
            this._processing = false;
        }

        this.push(data);
    }

    _read(size) {
        if (this._ended) {
            return;
        }

        // console.log('_read', size, this._readSize);
        this._readSize = size || this.readableHighWaterMark;

        // allocate buffer
        if (this.buffer === null || this.buffer.length < 2 * this._readSize) {
            const newBuffer = Buffer.alloc(2 * this._readSize); // allocate x2 since string chars can be encoded as 2 bytes

            if (this.buffer !== null && this.bufferOffset > 0) {
                this.buffer.copy(newBuffer, 0, 0, this.bufferOffset);
            }

            this.buffer = newBuffer;
        }

        // start processing
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
