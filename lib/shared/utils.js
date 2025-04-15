const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { Readable } = require('stream');
const { EventEmitter } = require('events');
const mime = require('mime');
const chalk = require('chalk');
const prettyMs = require('pretty-ms');
const discoveryCliPath = path.resolve(__dirname, '../..');
const ANSI_REGEXP = /([\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g;

let printIdent = 0;
let silent = false;
const processName = require.main
    ? require('path').basename(require.main.filename)
    : '<unknown process>';

function stdoutWrite(str) {
    if (!silent) {
        process.stdout.write(str);
    }
}

function print(...args) {
    stdoutWrite('  '.repeat(printIdent) + args.join(' '));
}

function println(...args) {
    stdoutWrite('  '.repeat(printIdent) + args.join(' ') + '\n');
}

function sectionStart(...args) {
    println(...args);
    printIdent++;
}

function sectionEnd(...args) {
    if (args.length) {
        println(...args);
    }

    printIdent = Math.max(printIdent - 1, 0);
}

function section(name, fn) {
    sectionStart(name);
    const res = fn();

    if (res && typeof res.then === 'function') {
        return res.finally(sectionEnd);
    }

    sectionEnd();
    return res;
}

function processStep(name, fn) {
    print(name + ' ... ');
    const startTime = Date.now();
    const res = fn();

    if (res && typeof res.then === 'function') {
        return res.then(res => {
            const time = Date.now() - startTime;
            stdoutWrite(`OK${time > 2 ? chalk.gray(` (${time}ms)`) : ''}\n`);

            return res;
        });
    }

    const time = Date.now() - startTime;
    stdoutWrite(`OK${time > 2 ? chalk.gray(` (${time}ms)`) : ''}\n`);

    return res;
}

async function silentFn(fn) {
    try {
        silent = true;
        return await fn();
    } finally {
        silent = false;
    }
}

function time() {
    const pad2 = value => String(value).padStart(2, 0);
    const now = new Date();

    return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

function prettyDuration(duration, options) {
    if (typeof options === 'boolean') {
        options = {
            spaces: options
        };
    } else if (!options) {
        options = {};
    }

    const result = prettyMs(duration, options);

    return options.spaces === false
        ? result.replace(/\s+/g, '')
        : result;
}

function createBufferingStream(inputReadable, maxBufferSize = 1024 * 1024) {
    if (maxBufferSize === 0) {
        return inputReadable;
    }

    const bufferingReadableStream = new ReadableStream({
        start() {
            this.reader = ReadableStream.from(inputReadable).getReader();
        },
        async pull(controller) {
            const chunks = [];
            let bufferSize = 0;

            while (bufferSize < maxBufferSize) {
                const { done, value } = await this.reader.read();

                if (done) {
                    break;
                }

                chunks.push(value);
                bufferSize += value.byteLength;
            }

            if (bufferSize > 0) {
                controller.enqueue(Buffer.concat(chunks));
            } else {
                controller.close();
                this.cancel();
            }
        },
        cancel() {
            if (this.reader) {
                this.reader.release();
                this.reader = null;
            }
        }
    });

    return Readable.fromWeb(bufferingReadableStream);
}

function isReadableStream(value) {
    return (
        value instanceof EventEmitter &&
        (typeof value.read === 'function' || typeof value._read === 'function') &&
        typeof value.pipe === 'function' &&
        value.readable !== false &&
        value.readableObjectMode === false
    );
}

function prepareStdStreamChunkForMessage(chunk) {
    return chunk
        // convert to string
        .toString('utf8')
        // strip ansi escapes
        .replace(ANSI_REGEXP, '');
}

function createEventsSource() {
    let listeners = [];
    let messages = [];
    let closed = false;
    const emit = (message) => {
        if (closed) {
            return;
        }

        messages.push(message);

        if (message === null) {
            closed = true;
        }

        for (const { fn } of listeners) {
            fn(message);
        }
    };

    return {
        emit,
        listen(fn) {
            let listener = { fn };

            Promise.resolve().then(() => {
                if (closed) {
                    listener = null;
                }

                if (listener === null) {
                    return;
                }

                for (let message of messages) {
                    fn(message);
                }

                listeners.push(listener);
            });

            return () => {
                listeners = listeners.filter(item => item !== listener);
                listener = null;
            };
        },
        dispose() {
            emit(null);
            listeners = [];
            messages = null;
        }
    };
}

function runScript(command, args) {
    const eventsSource = createEventsSource();
    const runScriptResult = new Promise((resolve_, reject_) => {
        let resolved = false;
        const stderr = [];
        const stderrBuffer = [];
        const child = fork(command, args, {
            execArgv: ['--unhandled-rejections=strict'],
            stdio: ['inherit', 'pipe', 'pipe', 'ipc', 'pipe'],
            env: {
                ...process.env,
                FORCE_COLOR: chalk.supportsColor ? chalk.supportsColor.level : 0
            }
        });

        eventsSource.emit({
            type: 'start',
            timestamp: Date.now()
        });

        child.stderr
            .on('data', chunk => {
                stderr.push(chunk);
                stderrBuffer.push(chunk);
                eventsSource.emit({
                    type: 'stderr',
                    chunk: serializeErrorForClient(chunk)
                });
            });
        child.stdout
            .on('data', chunk => {
                if (stderrBuffer) {
                    // flush error buffer
                    stderrBuffer.splice(0, Infinity).forEach(chunk =>
                        process.stderr.write(chalk.yellow(chunk))
                    );
                }

                process.stdout.write(chunk);
                eventsSource.emit({
                    type: 'stdout',
                    chunk: prepareStdStreamChunkForMessage(chunk)
                });
            });
        child
            .on('message', async message => {
                if (message.type) {
                    eventsSource.emit(message);
                    return;
                }

                if (message.payload === 'stream') {
                    try {
                        resolve({
                            ...message,
                            stream: createBufferingStream(child.stdio[4], 1024 * 1024)
                        });
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    resolve(message);
                }
            })
            .on('close', code => {
                const stderrOutput = stderr.join('');

                if (stderrOutput || code) {
                    const error = new Error(stderrOutput || 'Child process script exited with code ' + code);

                    if (resolved) {
                        process.stderr.write([
                            chalk.white.bgRed('CHILD SCRIPT ERROR') + chalk.gray(' (after a result promise is resolved)'),
                            chalk.red('| ') + chalk.yellow([command].concat(args).join(' ')),
                            chalk.red('|'),
                            chalk.red('| ') + chalk.red(error.message.replace(/\r\n?|\n/g, '\n| '))
                        ].join('\n') + '\n');
                    }

                    reject(error);
                }

                // make sure promise is fulfilled on script finish
                reject(new Error('Unresolved runScript promise'));
            });

        function resolve(...args) {
            resolved = true;
            resolve_(...args);
        }
        function reject(...args) {
            resolved = true;
            reject_(...args);
        }
    }).catch((error) => {
        eventsSource.emit({
            type: 'crash',
            timestamp: Date.now()
        });
        throw error;
    }).finally(() => {
        eventsSource.emit({
            type: 'finish',
            timestamp: Date.now()
        });
        eventsSource.dispose();
    });

    return Object.assign(runScriptResult, {
        listen: eventsSource.listen
    });
}

function logMsg(...args) {
    console.log(
        chalk.grey(time()),
        chalk.grey(processName),
        ...args
    );
}

function logError(...args) {
    console.error(
        chalk.grey(time()),
        chalk.grey(processName),
        chalk.bgRed.white('ERROR'),
        ...args.map(val => val instanceof Error ? '\n' + chalk.redBright(val) : val)
    );
}

function logWarning(...args) {
    console.warn(
        chalk.grey(time()),
        chalk.grey(processName),
        chalk.bgYellow.black('WARNING'),
        ...args.map(val => val instanceof Error ? '\n' + chalk.yellow(val) : val)
    );
}

function logSlugMsg(slug, ...args) {
    logMsg(chalk.cyan(slug), ...args);
}

function logSlugError(slug, ...args) {
    logError(chalk.cyan(slug), ...args);
}

function logSlugWarning(slug, ...args) {
    logWarning(chalk.cyan(slug), ...args);
}

function toRegExp(str) {
    return new RegExp(str.replace(/\[\]\(\)\{\}\.\+\*\?/g, '\\$1'), 'g');
}

function serializeErrorForClient(error) {
    const cwd = process.cwd();
    const text = String(error.stack || error).replace(ANSI_REGEXP, '');

    if (cwd) {
        const cwdRx = toRegExp(cwd);
        const discoveryCliRx = toRegExp(discoveryCliPath);

        return text
            .replace(cwdRx, '.')
            .replace(discoveryCliRx, path.relative(cwd, discoveryCliPath));
    }

    return text;
}

function sortModels(models) {
    return models.slice().sort(({ slug: a }, { slug: b }) =>
        a > b ? 1 : a < b ? -1 : 0
    );
}

function nameExt(pathname) {
    const ext = path.extname(pathname);

    return {
        name: pathname.slice(0, -ext.length),
        ext: ext.slice(1)
    };
}

function buildEntryNameByPattern(pattern = '[slug]/index', values) {
    return path.posix.resolve('/', pattern.replace(
        /\[([a-z]+)\]/g,
        (m, name) => values[name] ?? m)
    ).slice(1) + '.html';
}

function buildScriptNameByPattern(pattern = '[slug]/[name]', entryName, values) {
    return path.posix.relative(
        path.posix.dirname(entryName),
        path.posix.resolve('/', pattern.replace(
            /\[([a-z]+)\]/g,
            (m, name) => values[name] ?? m)
        ).slice(1) + '.' + values.ext
    );
}

function buildAssetNameByPattern(pattern = '[slug]/[name]', entryName, values) {
    return path.posix.relative(
        path.posix.dirname(entryName),
        path.posix.resolve('/', pattern.replace(
            /\[([a-z]+)\]/g,
            (m, name) => values[name] ?? m)
        ).slice(1) + '.' + values.ext
    );
}

function dataUriForPath(filepath, content) {
    return `data:${mime.getType(path.extname(filepath))};base64,${
        content || fs.readFileSync(filepath, 'base64')
    }`;
}

module.exports = {
    print,
    println,
    section,
    sectionStart,
    sectionEnd,
    process: processStep,
    silent: silentFn,
    time,
    prettyDuration,
    runScript,
    logMsg,
    logError,
    logWarning,
    logSlugMsg,
    logSlugError,
    logSlugWarning,
    serializeErrorForClient,
    sortModels,
    nameExt,
    buildEntryNameByPattern,
    buildScriptNameByPattern,
    buildAssetNameByPattern,
    dataUriForPath,
    isReadableStream
};
