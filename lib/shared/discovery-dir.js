const fs = require('fs');
const path = require('path');
const pkgJson = path.join(process.cwd(), 'package.json');

module.exports = fs.existsSync(pkgJson) && require(pkgJson).name === '@discoveryjs/discovery'
    ? process.cwd()
    : path.dirname(require.resolve('@discoveryjs/discovery/package.json', {
        paths: [process.cwd()]
    }));
