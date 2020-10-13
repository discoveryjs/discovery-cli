const { fork } = require('child_process');
const chalk = require('chalk');
const prettyMs = require('pretty-ms');
const parseDuration = require('parse-duration');

let printIdent = 0;
let silent = false;
const processName = require.main
    ? '[' + require('path').basename(require.main.filename) + ']'
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
    print(...args.concat('\n'));
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
    const res = fn();

    if (res && typeof res.then === 'function') {
        return res.then(res => {
            stdoutWrite('OK\n');
            return res;
        });
    }

    stdoutWrite('OK\n');
    return res;
}

function silentFn(fn) {
    silent = true;
    fn();
    silent = false;
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

function runScript(command, args) {
    return new Promise((resolve, reject) => {
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
            });
        child
            .on('message', message => {
                try {
                    if (message.payload === 'stream') {
                        resolve({
                            stream: child.stdio[4],
                            size: message.size
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
            });
    });
}

function logMsg(...args) {
    console.log(
        chalk.grey(time()),
        chalk.hex('#77c9d2')(processName),
        ...args
    );
}

function logError(...args) {
    console.error(
        chalk.grey(time()),
        chalk.hex('#77c9d2')(processName),
        chalk.bgRed.white('ERROR'),
        ...args.map(val => val instanceof Error ? '\n' + chalk.redBright(val) : val)
    );
}

function logSlugMsg(slug, ...args) {
    logMsg(chalk.cyan(slug), ...args);
}

function logSlugError(slug, ...args) {
    logError(chalk.cyan(slug), ...args);
}

function serializeErrorForClient(error) {
    const home = process.env.HOME;
    const rx = new RegExp(home.replace(/\[\]\(\)\{\}\.\+\*\?/g, '\\$1'), 'g');
    const text = String(error.stack || error);

    return home ? text.replace(rx, '~') : text;
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
    logSlugMsg,
    logSlugError,
    serializeErrorForClient,
    DATA_PLACEHOLDER: '__DISCOVERY_DATA_PLACEHOLDER__',
    MODE_PLACEHOLDER: '__DISCOVERY_MODE_PLACEHOLDER__',
    SETUP_MODEL_PLACEHOLDER: '__DISCOVERY_SETUP_MODEL_PLACEHOLDER__'
};
