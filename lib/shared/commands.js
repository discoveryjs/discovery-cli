const fs = require('fs');
const path = require('path');
const binpath = path.join(__dirname, '../../bin');

module.exports = Object.fromEntries(
    fs.readdirSync(binpath).map(name => [name, path.join(binpath, name)])
);
