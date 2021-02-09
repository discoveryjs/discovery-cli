const { logSlugMsg} = require('../shared/utils');

module.exports = function dropDataCache({ slug }, cacheDispatcher) {
    return (req, res) => {
        logSlugMsg(slug, 'Enforce cache update');
        cacheDispatcher.reset(slug);

        res.status(200).send('OK');
    };
};
