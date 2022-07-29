function createProcessEventSource() {
    const map = new Map();

    return {
        // consumer
        listen(id, fn) {
            const status = map.get(id);
            let listener = { fn, stopListen: null };

            if (status === undefined) {
                Promise.resolve().then(() => fn(null));
                return () => {};
            }

            status.listeners.push(listener);

            if (status.listenSource) {
                listener.stopListen = status.listenSource(fn);
            }

            return () => {
                if (listener === null) {
                    return;
                }

                if (status !== undefined) {
                    status.listeners = status.listeners
                        .filter(item => item !== listener);
                }

                if (typeof listener.stopListen === 'function') {
                    listener.stopListen();
                }

                listener = null;
            };
        },

        // provider
        attach(id, listenSource) {
            const status = map.get(id);

            if (status === undefined) {
                return;
            }

            const listeners = status.listeners;

            status.listenSource = listenSource;

            for (const listener of listeners) {
                listener.stopListen = listenSource(listener.fn);
            }
        },
        has(id) {
            return map.has(id);
        },
        add(id) {
            map.set(id, {
                listenSource: null,
                listeners: []
            });
        },
        delete(id) {
            const status = map.get(id);

            map.delete(id);

            if (status === undefined) {
                return;
            }

            for (const listener of status.listeners.slice()) {
                if (typeof listener.stopListen === 'function') {
                    listener.stopListen();
                } else {
                    listener.fn(null);
                }
            }
        }
    };
}

module.exports = {
    createProcessEventSource
};
