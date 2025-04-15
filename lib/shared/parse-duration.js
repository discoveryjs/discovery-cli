// Adopted version of https://github.com/jkroso/parse-duration
// The package migrated to ESM and discarded CJS, at the same time 1.x versions with CJS support
// has security warnings

const units = Object.create(null);
const m = 60000;
const h = m * 60;
const d = h * 24;
const y = d * 365.25;

units.year = units.yr = units.y = y;
units.month = units.mo = units.mth = y / 12;
units.week = units.wk = units.w = d * 7;
units.day = units.d = d;
units.hour = units.hr = units.h = h;
units.minute = units.min = units.m = m;
units.second = units.sec = units.s = 1000;
units.millisecond = units.millisec = units.ms = 1;
units.microsecond = units.microsec = units.us = units.µs = 1e-3;
units.nanosecond = units.nanosec = units.ns = 1e-6;

units.group = ',';
units.decimal = '.';
units.placeholder = ' _';
units[''] = false;

const durationRE = /((?:\d{1,16}(?:\.\d{1,16})?|\.\d{1,16})(?:[eE][-+]?\d{1,4})?)\s?([\p{L}]{0,14})/gu;

/**
 * convert `str` to ms
 *
 * @param {string} str
 * @param {string} format
 * @return {number|null}
 */
exports.parseDuration = function parseDuration(str = '', format = 'ms') {
    let result = null;
    let prevUnits;

    String(str)
        .replace(new RegExp(`(\\d)[${units.placeholder}${units.group}](\\d)`, 'g'), '$1$2')  // clean up group separators / placeholders
        .replace(units.decimal, '.') // normalize decimal separator
        .replace(durationRE, (_, n, units) => {
            // if no units, find next smallest units or fall back to format value
            // eg. 1h30 -> 1h30m
            if (!units) {
                if (prevUnits) {
                    for (const u in units) {
                        if (units[u] < prevUnits) {
                            units = u; break;
                        }
                    }
                } else {
                    units = format;
                }
            } else {
                units = units.toLowerCase();
            }

            prevUnits = units = units[units] || units[units.replace(/s$/, '')];

            if (units) {
                result = (result || 0) + n * units;
            }
        });

    return result && ((result / (units[format] || 1)) * (str[0] === '-' ? -1 : 1));
};
