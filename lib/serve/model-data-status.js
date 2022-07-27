module.exports = function data(generateDataEvents) {
    return async function getDataStatusEvents(req, res) {
        const dataRequestId = req.query['data-request-id'];

        if (!dataRequestId) {
            res.status(500).end('Missed "data-request-id" query parameter');
            return;
        }

        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.flushHeaders();

        const closeConnection = () => res.end('event: done\ndata:\n\n');
        const stopListenStatus = generateDataEvents.listen(dataRequestId, (message) => {
            if (message === null) {
                return closeConnection();
            }

            res.write(`data: ${JSON.stringify(message)}\n\n`); // res.write() instead of res.send()
        });

        // if client closes connection, stop sending events
        res.on('close', () => {
            stopListenStatus();
            closeConnection();
        });
    };
};
