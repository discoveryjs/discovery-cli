const { logSlugMsg} = require('../shared/utils');

module.exports = function dropDataCache({ slug }, cacheDispatcher) {
    return (req, res) => {
        logSlugMsg(slug, 'Force cache update');
        cacheDispatcher.write(slug, true);

        res.status(200).send('OK');
    };
};
