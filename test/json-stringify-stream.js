// Fork of https://github.com/Faleij/json-stream-stringify
const assert = require('assert');
const fs = require('fs');
const { Readable } = require('stream');
const createJsonStringifyStream = require('../lib/shared/create-json-stringify-stream');

function createTest(input, expected, ...args) {
    return () => new Promise((resolve, reject) => {
        let str = '';
        const jsonStream = createJsonStringifyStream(input, ...args)
            .on('data', (data) => {
                str += data.toString();
            })
            .once('end', () => {
                try {
                    assert.strictEqual(str, expected);
                } catch (err) {
                    reject(err);
                    return;
                }
                setImmediate(() => resolve({ jsonStream }));
            })
            .once('error', err => reject(Object.assign(err, {
                jsonStream
            })));
    });
}

const streamRead = (stream, args, timeout) => async () => {
    if (!args.length) {
        return stream.push(null);
    }
    const v = args.shift();
    if (v instanceof Error) {
        return stream.emit('error', v);
    }

    return timeout
        ? stream.push(await new Promise((resolve) => setTimeout(() => resolve(v), timeout)))
        : stream.push(v);
};

function ReadableStream(...args) {
    const stream = new Readable({
        objectMode: args.some(v => typeof v !== 'string')
    });
    stream._read = streamRead(stream, args);
    return stream;
}

function ReadableStreamTimeout(...args) {
    const stream = new Readable({
        objectMode: args.some(v => typeof v !== 'string')
    });
    stream._read = streamRead(stream, args, 1);
    return stream;
}

describe('createJsonStringifyStream()', () => {
    const date = new Date();

    it('null should be null', createTest(null, 'null'));

    it('Infinity should be null', createTest(Infinity, 'null'));

    it('date should be date.toJSON()', createTest(date, `"${date.toJSON()}"`));

    it('true should be true', createTest(true, 'true'));

    it('Symbol should be ""', createTest(Symbol('test'), 'null'));

    it('1 should be 1', createTest(1, '1'));

    it('1 should be 2', createTest(1, '2', () => 2));

    it('"\\n" should be "\\\\n"', createTest('\n', '"\\n"'));

    it('"漢字" should be "漢字"', createTest('漢字', '"漢字"'));

    it.skip('"\\u009f" should be "\\\\u009f"', createTest('\u009f', '"\\u009f"'));

    it('{} should be {}', createTest({}, '{}'));

    it('/regex/gi should be {}', createTest(/regex/gi, '{}'));

    it('{a:undefined} should be {}', createTest({
        a: undefined
    }, '{}'));

    it('{a:null} should be {"a":null}', createTest({
        a: null
    }, '{"a":null}'));

    it('{a:1} should be {"a":1}', createTest({
        a: 1
    }, '{"a":1}'));

    it('{a:undefined,b:undefined} should be {}', createTest({
        a: undefined,
        b: undefined
    }, '{}'));
    it('{a:undefined,b:1} should be {"b":1}', createTest({
        a: undefined,
        b: 1
    }, '{"b":1}'));
    it('{a:1,b:undefined} should be {"a":1}', createTest({
        a: 1,
        b: undefined
    }, '{"a":1}'));
    it('{a:1,b:undefined,c:2} should be {"a":1,"c":2}', createTest({
        a: 1,
        b: undefined,
        c: 2
    }, '{"a":1,"c":2}'));

    it('{a:function(){}, b: "b"} should be {"b": "b"}', createTest({
        a() {},
        b: 'b'
    }, '{"b":"b"}'));

    it('[function(){}] should be [null]', createTest([function a() {}], '[null]'));

    it('[function(){}, undefined] should be [null,null]', createTest([function a() {}, undefined], '[null,null]'));

    it('({a:1,b:{c:2}}) should be {"a":1,"b":{"c":2}}', createTest(({
        a: 1,
        b: {
            c: 2
        }
    }), '{"a":1,"b":{"c":2}}'));

    it('{a:[1], "b": 2} should be {"a":[1],"b":2}', createTest({
        a: [1],
        b: 2
    }, '{"a":[1],"b":2}'));

    it('[] should be []', createTest([], '[]'));

    it('[[[]],[[]]] should be [[[]],[[]]]', createTest([
        [
            []
        ],
        [
            []
        ]
    ], '[[[]],[[]]]'));

    it('[1, undefined, 2] should be [1,null,2]', createTest([1, undefined, 2], '[1,null,2]'));

    it('[1, , 2] should be [1,null,2]', createTest([1, , 2], '[1,null,2]'));

    it('[1,\'a\'] should be [1,"a"]', createTest([1, 'a'], '[1,"a"]'));
    it('[{},[],{a:[],o:{}}] should be [{},[],{"a":[],"o":{}}]', createTest([{}, [], { a: [], o: {} }], '[{},[],{"a":[],"o":{}}]'));

    describe('toJSON()', () => {
        it('{a:date} should be {"a":date.toJSON()}', createTest({
            a: date
        }, `{"a":"${date.toJSON()}"}`));
    });

    describe('replacer', () => {
        it('{a:undefined} should be {"a":1}', createTest({
            a: undefined
        }, '{"a":1}', (k, v) => {
            if (k) {
                assert.strictEqual(k, 'a');
                assert.strictEqual(v, undefined);
                return 1;
            }
            return v;
        }));

        it('{a:1, b:2} should be {"a":1}', createTest({
            a: 1,
            b: 2
        }, '{"a":1}', (k, v) => {
            if (k === 'a' && v === 1) {
                return v;
            }
            if (k === 'b' && v === 2) {
                return undefined;
            }
            return v;
        }));

        it('array as replacer', createTest({
            a: 1,
            b: 2
        }, '{"b":2}', ['b']));

        it('toJSON/replacer order', createTest({
            status: 'fail',
            toJSON() {
                return { status: 'ok' };
            }
        }, '"ok"', (key, value) => value.status));
    });

    describe('Promise', () => {
        it('Promise(1) should be 1', createTest(Promise.resolve(1), '1'));

        it('Promise(Promise(1)) should be 1', createTest(Promise.resolve(Promise.resolve(1)), '1'));

        it('{a:1,b:Promise(undefined)} should be {"a":1}', createTest({
            a: 1,
            b: Promise.resolve(undefined)
        }, '{"a":1}'));
        it('{a:Promise(undefined),b:2} should be {"b":2}', createTest({
            a: Promise.resolve(undefined),
            b: 2
        }, '{"b":2}'));
        it('{a:Promise(undefined),b:Promise(undefined)} should be {}', createTest({
            a: Promise.resolve(undefined),
            b: Promise.resolve(undefined)
        }, '{}'));

        it('Promise(fakePromise(Promise.resolve(1))) should be 1', createTest(({
            then(fn) {
                return Promise.resolve(1).then(fn);
            }
        }), '1'));

        it('Promise.reject(Error) should emit Error', () => {
            const err = new Error('should emit error');
            return assert.rejects(
                createTest(new Promise((resolve, reject) => reject(err)), '')(),
                err1 => {
                    assert.strictEqual(err1, err);
                    return true;
                }
            );
        });

        it('{a:Promise(1)} should be {"a":1}', createTest({
            a: Promise.resolve(1)
        }, '{"a":1}'));

        it('[Promise(1)] should be [1]', createTest([Promise.resolve(1)], '[1]'));
        it('[1,Promise(2),Promise(undefined),3] should be [1,2,null,3]', createTest([1, Promise.resolve(2), Promise.resolve(), 3], '[1,2,null,3]'));
    });

    describe('Stream', () => {
        it('ReadableStream(1) should be [1]', createTest(ReadableStream(1), '[1]'));

        it('ReadableStream({ foo: 1, bar: 2 }, { baz: 3 }) should be [{"foo":1,"bar":2},{"baz":3}]',
            createTest(
                ReadableStream({ foo: 1, bar: 2 }, { baz: 3 }),
                '[{"foo":1,"bar":2},{"baz":3}]'
            )
        );

        it.skip('fs.createReadStream(path) should be content of file (fixture.json)',
            createTest(
                fs.createReadStream(__dirname + '/fixture.json'),
                fs.readFileSync(__dirname + '/fixture.json', 'utf8')
            )
        );
        it.skip('fs.createReadStream(path) should be content of file (fixture2.json)',
            createTest(
                fs.createReadStream(__dirname + '/fixture2.json'),
                fs.readFileSync(__dirname + '/fixture2.json', 'utf8')
            )
        );

        it('Promise(ReadableStream(1)) should be [1]', createTest(Promise.resolve(ReadableStream(1)), '[1]'));

        it('{a:[ReadableStream(1, Error, 2)]} should emit Error', () => {
            const err = new Error('should emit error');
            return assert.rejects(
                createTest({
                    a: [ReadableStream(1, err, 2)]
                }, '')(),
                (err1) => {
                    // expect(err.jsonStream.stack).to.eql(['a', 0]);
                    assert.deepEqual(err1, err);
                    return true;
                }
            );
        });

        it('ReadableStream(1, 2, 3, 4, 5, 6, 7).resume() should emit Error', () =>
            assert.rejects(
                createTest(ReadableStream(1, 2, 3, 4, 5, 6, 7).resume(), '[1,2,3,4,5,6,7]')(),
                (err) => {
                    assert.strictEqual(err.message, 'Readable Stream is in flowing mode, data may have been lost. Trying to pause stream.');
                    return true;
                }
            )
        );

        it('EndedReadableStream(1, 2, 3, 4, 5, 6, 7) should emit Error', () => {
            const stream = ReadableStream(1, 2, 3, 4, 5, 6, 7);
            return assert.rejects(
                createTest(new Promise(resolve => stream.once('end', () => resolve(stream)).resume()), '[1,2,3,4,5,6,7]')(),
                (err) => {
                    // console.log(err);
                    assert.strictEqual(err.message, 'Readable Stream has ended before it was serialized. All stream data have been lost');
                    return true;
                }
            );
        });

        it('{a:ReadableStream(1,2,3)} should be {"a":[1,2,3]}', createTest({
            a: ReadableStream(1, 2, 3)
        }, '{"a":[1,2,3]}'));

        it('ReadableStream(\'{\', \'"b":1\', \'}\') should be "{"b":1}"',
            createTest(ReadableStream('{', '"b":1', '}'), '{"b":1}')
        );

        it('ReadableStream(\'{\', \'"b":1\', \'}\') should be "{"b":1}"', () => {
            const stream = new Readable();
            const args = ['{', '"b":1', '}'];
            Object.assign(stream, {
                firstRead: true,
                _read() {
                    setTimeout(() => {
                        if (!args.length) {
                            return stream.push(null);
                        }
                        const v = args.shift();
                        if (v instanceof Error) {
                            return stream.emit('error', v);
                        }
                        return stream.push(v);
                    }, 1);
                }
            });
            return createTest(stream, '{"b":1}')();
        });

        it('ReadableStream({}, \'a\', undefined, \'c\') should be [{},"a",null,"c"]', createTest(ReadableStream({}, 'a', undefined, 'c'), '[{},"a",null,"c"]'));

        it(`{ a: ReadableStream({name: 'name', date: date }) } should be {"a":[{"name":"name","date":"${date.toJSON()}"}]}`, createTest({
            a: ReadableStream({
                name: 'name',
                date
            })
        }, `{"a":[{"name":"name","date":"${date.toJSON()}"}]}`));

        it(`{ a: ReadableStream({name: 'name', arr: [], date: date }) } should be {"a":[{"name":"name","arr":[],"date":"${date.toJSON()}"}]}`, createTest({
            a: ReadableStream({
                name: 'name',
                arr: [],
                obj: {},
                date
            })
        }, `{"a":[{"name":"name","arr":[],"obj":{},"date":"${date.toJSON()}"}]}`));

        it('It should not finish stream if source stream is pending',
            createTest(
                ReadableStreamTimeout({ foo: 1 }, { bar: 2 }, { baz: 3 }),
                '[{"foo":1},{"bar":2},{"baz":3}]'
            )
        );
    });

    describe('space option', () => {
        it('{} should be {}', createTest({}, '{}', undefined, 2));
        it('{ a: 1 } should be {\\n  "a": 1\\n}', createTest({ a: 1 }, '{\n  "a": 1\n}', undefined, 2));
        it('{ a: 1, b: 2 } should be {\\n  "a": 1,\\n  "b": 2\\n}', createTest({ a: 1, b: 2 }, '{\n  "a": 1,\n  "b": 2\n}', undefined, 2));

        it('[] should be []', createTest([], '[]', undefined, 2));
        it('[1] should be [\\n  1\\n]', createTest([1], '[\n  1\n]', undefined, 2));
        it('[1,2] should be [\\n  1\\n  2\\n]', createTest([1, 2], '[\n  1,\n  2\n]', undefined, 2));
        it('[1,[2,3],Promise,ReadableStream,ReadableStream] should be ...', createTest([
            1,
            [2, 3],
            Promise.resolve(4),
            ReadableStream(5),
            ReadableStream('6')
        ], '[\n  1,\n  [\n    2,\n    3\n  ],\n  4,\n  [\n    5\n  ],\n  6\n]', undefined, 2));

        it('[1] should be [\\n_1\\n]', createTest([1], '[\n_1\n]', undefined, '_'));
        it('[1,2] should be [\\n_1,\\n_2\\n]', createTest([1, 2], '[\n_1,\n_2\n]', undefined, '_'));
    });

    describe('circular structure', () => {
        const cyclicData0 = {};
        cyclicData0.a = cyclicData0;
        it('{ a: $ } should emit error', () =>
            assert.rejects(
                createTest(cyclicData0, '')(),
                (err) => {
                    assert.strictEqual(err.message, 'Converting circular structure to JSON');
                    return true;
                }
            )
        );

        const cyclicData1 = {};
        cyclicData1.a = Promise.resolve(cyclicData1);
        it('{ a: Promise($) } should be emit error', () =>
            assert.rejects(
                createTest(Promise.resolve(cyclicData1), '')(),
                (err) => {
                    assert.strictEqual(err.message, 'Converting circular structure to JSON');
                    return true;
                }
            )
        );

        const cyclicData2 = {};
        cyclicData2.a = ReadableStream(cyclicData2);
        it('{ a: ReadableStream($) } should be emit error', () =>
            assert.rejects(
                createTest(ReadableStream(cyclicData2), '')(),
                (err) => {
                    assert.strictEqual(err.message, 'Converting circular structure to JSON');
                    return true;
                }
            ));

        const a = {
            foo: 'bar'
        };
        const arr = [a, a];
        it('decycle should not be active', createTest(arr, '[{"foo":"bar"},{"foo":"bar"}]'));
    });
});
