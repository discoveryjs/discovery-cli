const fs = require('fs');
const path = require('path');
const resolve = require('resolve');
const pkgJson = path.join(process.cwd(), 'package.json');

module.exports = fs.existsSync(pkgJson) && require(pkgJson).name === '@discoveryjs/discovery'
    ? process.cwd()
    : path.dirname(resolve.sync('@discoveryjs/discovery/package.json', {
        basedir: path.join(__dirname, '../..')
    }));
