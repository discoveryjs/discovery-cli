const { Readable } = require('stream');

function isReadableStream(value) {
    return (
        typeof value.pipe === 'function' &&
        typeof value._read === 'function' &&
        typeof value._readableState === 'object' && value._readableState !== null
    );
}

module.exports = class ChunkedContent extends Readable {
    constructor(content) {
        super({
            autoDestroy: true
        });

        this.values = new Map();
        this.content = content;
        this.contentChunks = null;

        this.error = null;
        this._processing = false;
        this._ended = false;
        this._readSize = 0;
        this._buffer = '';
    }

    replace(pattern, fn) {
        this.contentChunks = null;
        this.content = this.content.replace(pattern, (...args) => {
            let chunks = fn(...args);

            if (!Array.isArray(chunks)) {
                chunks = [chunks];
            }

            return chunks.map(chunk => {
                if (chunk === null || typeof chunk !== 'object') {
                    return chunk;
                }

                const key = '{{__discovery_placeholder_' + this.values.size + '}}';
                this.values.set(key, chunk);
                return key;
            }).join('');
        });

        return this;
    }

    get currentChunk() {
        return this.contentChunks && this.contentChunks[0] || null;
    }

    processChunks() {
        if (this._processing || this._ended) {
            return;
        }

        try {
            this._processing = true;

            while (this.currentChunk !== null && !this.currentChunk.awaiting) {
                const current = this.currentChunk;
                const value = current.value;

                switch (true) {
                    default:
                        this.push(value);
                        this.contentChunks.shift();
                        break;

                    case value && typeof value.then === 'function':
                        this.currentChunk.awaiting = true;

                        Promise.resolve(value)
                            .then(resolved => {
                                this.contentChunks[0] = {
                                    value: resolved
                                };
                                this.processChunks();
                            })
                            .catch(error => {
                                this.destroy(error);
                            });
                        break;

                    case isReadableStream(value): {
                        if (!current.readStream) {
                            if (value.readableEnded) {
                                return this.destroy(new Error('Readable Stream has ended before it was serialized. All stream data have been lost'));
                            }

                            if (value.readableFlowing) {
                                return this.destroy(new Error('Readable Stream is in flowing mode, data may have been lost. Trying to pause stream.'));
                            }

                            const continueProcessing = () => {
                                if (current.awaiting) {
                                    current.awaiting = false;
                                    this.processChunks();
                                }
                            };

                            value.once('error', error => this.destroy(error));
                            value.once('end', continueProcessing);
                            value.on('readable', continueProcessing);

                            current.first = false;
                            current.awaiting = !value.readable || value.readableLength === 0;
                            current.readStream = () => {
                                const data = value.read(this._readSize);

                                if (data !== null) {
                                    current.first = false;
                                    this.push(data);
                                } else {
                                    if (current.first && !value._readableState.reading) {
                                        this.contentChunks.shift();
                                    } else {
                                        current.first = true;
                                        current.awaiting = true;
                                    }
                                }
                            };
                        } else if (!current.awaiting) {
                            current.readStream();
                        }

                        break;
                    }
                }

                if (!this._processing) {
                    return;
                }
            }

            this._processing = false;
        } catch (error) {
            this.destroy(error);
            return;
        }

        if (this.currentChunk === null && !this._ended) {
            this._finish();
            this.push(null);
        }
    }

    push(data) {
        if (data !== null) {
            this._buffer += data;

            // check buffer overflow
            if (this._buffer.length < this._readSize) {
                return;
            }

            // flush buffer
            data = this._buffer;
            this._buffer = '';
            this._processing = false;
        }

        super.push(data);
    }

    _read(size) {
        if (this.contentChunks === null) {
            this.contentChunks = this.content
                .split(/(\{\{__discovery_placeholder_\d+\}\})/)
                .map(chunk => ({
                    value: this.values.has(chunk) ? this.values.get(chunk) : chunk
                }));
        }

        // start processing
        this._readSize = size || this.readableHighWaterMark;
        this.processChunks();
    }

    _finish() {
        this._ended = true;

        if (this._buffer && this._buffer.length) {
            super.push(this._buffer); // flush buffer
        }

        this._buffer = '';
    }

    _destroy(error, cb) {
        this.error = this.error || error;
        this._finish();
        cb(error);
    }
};

// const x = new (module.exports)('asdXXfsa234adadXXasd33')
//     .replace(/\d+/g, (m) => Promise.resolve(m).then(x => '[[!' + x + ']]'))
//     .replace(/XX/g, () => ['>', Readable.from(['(a)', Promise.resolve('(c)'), new Promise(resolve => setTimeout(() => resolve('!!'), 1000))], {objectMode: true}), '<']);

// x.pipe(process.stdout);
