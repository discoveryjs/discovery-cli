module.exports = function data(generateDataEvents) {
    return async function getDataStatusEvents(req, res) {
        const dataRequestId = req.query['data-request-id'];
        let connectionClosed = false;
        let elapsedEventTimer;

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

        const sendEvent = (eventName, data) => {
            if (!connectionClosed) {
                const event = eventName ? `event: ${eventName}\n` : '';
                res.write(`${event}data: ${JSON.stringify(data)}\n\n`); // res.write() instead of res.send()
            }
        };
        const closeConnection = () => {
            connectionClosed = true;
            clearInterval(elapsedEventTimer);
            stopListenEvents();
            res.end('event: done\ndata:\n\n');
        };
        const stopListenEvents = generateDataEvents.listen(dataRequestId, (message) => {
            if (message === null) {
                return closeConnection();
            }

            if (message.type === 'start' && !elapsedEventTimer) {
                elapsedEventTimer = setInterval(
                    () => sendEvent('server-time', Date.now()),
                    127
                );
            }

            sendEvent(null, message);
        });

        // if client closes connection, stop sending events
        res.on('close', closeConnection);
    };
};
