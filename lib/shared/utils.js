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

function prettyDuration(duration, space) {
    let unit = 'ms';

    if (duration % 1000 === 0) {
        unit = 's';
        duration /= 1000;

        if (duration % 60 === 0) {
            unit = 'min';
            duration /= 60;

            if (duration % 60 === 0) {
                unit = 'h';
                duration /= 60;
            }
        }
    }

    return `${duration}${space ? ' ' : ''}${unit}`;
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
    prettyDuration
};