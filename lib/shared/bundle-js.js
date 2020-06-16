const browserify = require('browserify');
const babelify = require('babelify');

module.exports = function(inputFilename, options = {}) {
    return new Promise((resolve, reject) => {
        browserify(inputFilename, {
            standalone: 'discovery',
            ...options
        })
            .transform(babelify, {
                presets: [
                    // require('@babel/plugin-transform-runtime')
                    ['@babel/preset-env', {
                        exclude: [
                            '@babel/plugin-transform-regenerator'
                        ]
                    }]
                ],
                generatorOpts: {
                    compact: true,
                    comments: false
                },
                ...options.babelify
            })
            .bundle((err, content) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        content
                    });
                }
            });
    });
};
