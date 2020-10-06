const { fork } = require('child_process');
const prettyMs = require('pretty-ms');
const parseDuration = require('parse-duration');

let printIdent = 0;
let silent = false;

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
        const child = fork(command, args, { stdio: ['inherit', 'inherit', 'pipe', 'ipc', 'pipe'] });

        child.stderr
            .on('data', chunk => {
                stderr.push(chunk);
                process.stderr.write(chunk);
            });
        child
            .on('message', message => {
                try {
                    if (message.payload === 'stream') {
                        resolve({
                            stream: child.stdio[4],
                            size: message.size,
                            brotli: message.brotli
                        });
                    }
                } catch (e) {}

                resolve(message);
            })
            .on('close', code => {
                const error = stderr.join('');

                if (error || code) {
                    reject(error || 'Process exit with code ' + code);
                }
            });
    });
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
    DATA_PLACEHOLDER: '__DISCOVERY_DATA_PLACEHOLDER__',
    MODE_PLACEHOLDER: '__DISCOVERY_MODE_PLACEHOLDER__',
    SETUP_MODEL_PLACEHOLDER: '__DISCOVERY_SETUP_MODEL_PLACEHOLDER__'
};
