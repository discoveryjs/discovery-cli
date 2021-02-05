module.exports = function(app) {
    app.get('/healthz', (_, res) => {
        res.status(200);
        res.send({ status: 'OK' });
    });
};
