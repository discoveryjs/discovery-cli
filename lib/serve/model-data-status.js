module.exports = function data(generateDataEvents) {
    return async function getDataStatusEvents(req, res) {
        const dataRequestId = req.query['data-request-id'];
        const startedPlanStepIds = new Set();
        let currentPlanStepId = undefined;
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

            switch (message.type) {
                case 'start':
                    if (!elapsedEventTimer) {
                        elapsedEventTimer = setInterval(
                            () => sendEvent('server-time', Date.now()),
                            1000
                        );
                    }
                    break;

                case 'plan-step-event':
                    if (message.stepEvent === 'start') {
                        startedPlanStepIds.add(message.stepId);
                        currentPlanStepId = Math.max(...startedPlanStepIds);
                    }

                    if (message.stepEvent === 'finish') {
                        startedPlanStepIds.delete(message.stepId);
                        currentPlanStepId = startedPlanStepIds.size
                            ? Math.max(...startedPlanStepIds)
                            : undefined;
                    }
                    break;

                case 'stdout':
                case 'stderr':
                    message.stepId = currentPlanStepId;
                    break;
            }

            sendEvent(null, message);
        });

        // if client closes connection, stop sending events
        res.on('close', closeConnection);
    };
};
