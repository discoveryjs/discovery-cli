/* eslint-env browser */
import inflateWasmSource from './inflate.wasm';

const base64alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const base64map = new Uint8Array(256);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let inflateWasmApi = null;

for (let i = 0; i < base64alphabet.length; i++) {
    base64map[base64alphabet.charCodeAt(i)] = i;
}

function jsDecodeBase64(input) {
    let inputSize = input.length;

    // ignore trailing "=" (padding)
    while (inputSize > 0 && input[inputSize - 1] === '=') {
        inputSize--;
    }

    let output = new Uint8Array(3 * Math.ceil(inputSize / 4));
    let enc1;
    let enc2;
    let enc3;
    let enc4;

    // decode
    for (let i = 0, j = 0; i < inputSize;) {
        enc1 = base64map[input.charCodeAt(i++) & 0xff];
        enc2 = base64map[input.charCodeAt(i++) & 0xff];
        enc3 = base64map[input.charCodeAt(i++) & 0xff];
        enc4 = base64map[input.charCodeAt(i++) & 0xff];

        output[j++] = (enc1 << 2) | (enc2 >> 4);
        output[j++] = (enc2 << 4) | (enc3 >> 2);
        output[j++] = (enc3 << 6) | enc4;
    }

    return output.subarray(0,
        // output size:
        // (length / 4) * 3 +
        ((inputSize >> 2) * 3) +
        // (length % 4) * 6 / 8
        (((inputSize % 4) * 6) >> 3)
    );
}

function createWasmModule(source, imports = {}) {
    const sourceBytes = jsDecodeBase64(source);
    const importObject = { imports };
    const module = new WebAssembly.Module(sourceBytes);

    return new WebAssembly.Instance(module, importObject);
}

function initInflateWasmApi() {
    const memory = new WebAssembly.Memory({ initial: 32 });
    const inflateModule = createWasmModule(inflateWasmSource, { memory });
    const { inputOffset, outputOffset, inflate } = inflateModule.exports;
    const inputMem = new Uint8Array(memory.buffer, inputOffset, outputOffset);
    const outputMem = new Uint8Array(memory.buffer, outputOffset);

    return function(base64chunk) {
        const size = inflate(encoder.encodeInto(base64chunk, inputMem).written);

        return decoder.decode(outputMem.subarray(0, size));
    };
}

export function inflate(base64chunk) {
    if (inflateWasmApi === null) {
        inflateWasmApi = initInflateWasmApi();
    }

    return inflateWasmApi(base64chunk);
}

// import { deflateRawSync } from 'zlib';
// import { readFileSync } from 'fs';
// const inflateWasmSource = readFileSync('./lib/static/inflate/inflate.wasm', 'base64');
// const data = deflateRawSync(Buffer.from('hello world'.repeat(10))).toString('base64');
// const decoded = inflate(data);
// console.log(decoded, decoded.length, data.length);
