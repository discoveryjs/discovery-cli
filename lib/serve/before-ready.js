const chalk = require('chalk');
const utils = require('../shared/utils');

function createBeforeReady(options) {
    const beforeReady = {
        tasks: [],
        tasksDone: 0,
        startTime: null,
        timeElapsed: null,
        add: (name, fn, critical = false) => beforeReady.tasks.push({
            name: name || 'Untitled',
            status: 'pending',
            critical,
            fn
        }),
        run() {
            beforeReady.startTime = Date.now();
            beforeReady.timeElapsed = 0;

            if (!beforeReady.tasks.length) {
                return;
            }

            utils.logMsg(`Await ${beforeReady.tasks.length} tasks before ready`);
            beforeReady.tasks.reduce(
                (pipeline, task) => pipeline.then(() => utils.logMsg('==== Task:', chalk.yellow(task.name)) || Object.assign(task, {
                    status: 'processing',
                    startTime: Date.now()
                }).fn())
                    .catch(error => {
                        utils.logError(`Warmup task "${task.name}" error:`, task.error = error);

                        if (task.critical) {
                            console.error('Exit due to warnup task is critical');
                            process.exit(2);
                        }

                        if (options.bail) {
                            console.error('Exit due to --bail option');
                            process.exit(2);
                        }
                    })
                    .finally(() => (beforeReady.tasksDone++, Object.assign(task, {
                        status: task.error ? 'failed' : 'ok',
                        duration: Date.now() - task.startTime
                    }))),
                Promise.resolve()
            ).finally(() => {
                beforeReady.timeElapsed = Date.now() - beforeReady.startTime;
                utils.logMsg('Warmup is DONE in', utils.prettyDuration(beforeReady.timeElapsed));
                console.log();
            });
        }
    };

    return beforeReady;
};

module.exports = {
    createBeforeReady
};
