module.exports = function(app, beforeReady) {
    app.get('/readyz', (_, res) => {
        const warmupStatus = {};

        if (beforeReady.tasks.length > 0) {
            warmupStatus.warmup = {
                tasksTotal: beforeReady.tasks.length,
                tasksDone: beforeReady.tasksDone,
                tasks: beforeReady.tasks.map(task => ({
                    ...task,
                    startTime: task.startTime && typeof task.startTime === 'number'
                        ? new Date(task.startTime).toISOString()
                        : task.startTime
                })),
                time: beforeReady.timeElapsed || Date.now() - beforeReady.startTime
            };
        }

        if (beforeReady.tasksDone < beforeReady.tasks.length) {
            res.status(500);
            res.send({
                status: `Await ready for ${beforeReady.tasks.length - beforeReady.tasksDone} of ${beforeReady.tasks.length} tasks`,
                ...warmupStatus
            });
        } else {
            res.status(200);
            res.send({
                status: 'Ready',
                ...warmupStatus
            });
        }
    });
};
