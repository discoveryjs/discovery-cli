const { fork } = require('child_process');
const chalk = require('chalk');
const prettyMs = require('pretty-ms');
const parseDuration = require('parse-duration');
const ANSI_REGEXP = /([\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><])/g;

// prevent parsing unit-less values in duration
parseDuration[''] = false;

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
        return res.then(res => {
            sectionEnd();
            return res;
        });
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
    const runScriptResult = new Promise((resolve, reject) => {
        const stderr = [];
        const stderrBuffer = [];
        const child = fork(command, args, {
            stdio: ['inherit', 'pipe', 'pipe', 'ipc', 'pipe'],
            env: {
                ...process.env,
                FORCE_COLOR: chalk.supportsColor ? chalk.supportsColor.level : 0
            }
        });

        child.stderr
            .on('data', chunk => {
                stderr.push(chunk);
                stderrBuffer.push(chunk);
                eventsSource.emit({
                    type: 'stderr',
                    chunk: prepareStdStreamChunkForMessage(chunk)
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
            .on('message', message => {
                try {
                    if (message.payload === 'stream') {
                        resolve({
                            ...message,
                            stream: child.stdio[4]
                        });
                    }
                } catch (e) {}

                resolve(message);
            })
            .on('close', code => {
                const error = stderr.join('');

                if (error || code) {
                    reject(new Error(error || 'Process exit with code ' + code));
                }

                // make sure promise is fulfilled on script finish
                reject(new Error('Unresolved runScript promise'));
            });
    }).finally(() =>
        eventsSource.dispose()
    );

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

function serializeErrorForClient(error) {
    const home = process.env.HOME || '';
    const text = String(error.stack || error);

    if (home) {
        const rx = new RegExp(home.replace(/\[\]\(\)\{\}\.\+\*\?/g, '\\$1'), 'g');

        return text.replace(rx, '~');
    }

    return text;
}

function sortModels(models) {
    return models.slice().sort(({ slug: a }, { slug: b }) =>
        a > b ? 1 : a < b ? -1 : 0
    );
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
    parseDuration,
    runScript,
    logMsg,
    logError,
    logWarning,
    logSlugMsg,
    logSlugError,
    logSlugWarning,
    serializeErrorForClient,
    sortModels
};
