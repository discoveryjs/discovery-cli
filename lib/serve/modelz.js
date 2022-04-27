module.exports = function(app, config) {
    const { name, mode, models } = config;

    app.get('/modelz', (_, res) => {
        res.status(200);
        res.send({
            name,
            mode,
            models: models.map(({ slug, name }) => ({
                slug,
                name
            }))
        });
    });
};
