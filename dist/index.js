import { d as debug, n as normalizeSlot, g as getInput, a as normalizeBlockIdentifier, p as parseRpcEndpointsJson, e as ensureBoostCacheDir, b as getSlotHintsPath, c as buildCacheKeys, f as cacheExports, s as saveState, C as CACHE_PRIMARY_KEY_STATE, h as CACHE_MATCHED_KEY_STATE, i as info, r as readSlotHintsFile, j as setFailed } from './input-utils-CwJwCTPx.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'os';
import 'crypto';
import 'fs';
import 'path';
import 'http';
import 'https';
import 'string_decoder';
import 'events';
import 'child_process';
import 'assert';
import 'timers';
import 'net';
import 'tls';
import 'util';
import 'node:assert';
import 'node:net';
import 'node:http';
import 'node:stream';
import 'node:buffer';
import 'node:util';
import 'node:querystring';
import 'node:events';
import 'node:diagnostics_channel';
import 'node:tls';
import 'node:zlib';
import 'node:perf_hooks';
import 'node:util/types';
import 'node:worker_threads';
import 'node:url';
import 'node:async_hooks';
import 'node:console';
import 'node:dns';
import 'url';
import 'node:os';
import 'node:process';
import 'node:https';
import 'tty';
import 'stream';
import 'node:crypto';
import 'buffer';
import 'node:fs';

const OVERRIDE_STORAGE_READER_CODE = '0x5f5b80361460135780355481526020016001565b365ff3';
const MAX_BATCH_SIZE = 1000;
const MAX_RETRIES = 5;
const MULTICALL3_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11';
const MULTICALL3_AGGREGATE3_SELECTOR = '82ad56cb';
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function stripHexPrefix(value) {
    return value.startsWith('0x') ? value.slice(2) : value;
}
function encodeUint256(value) {
    const hex = value.toString(16);
    return hex.padStart(64, '0');
}
function encodeBool(value) {
    return encodeUint256(value ? 1n : 0n);
}
function encodeAddress(address) {
    return `${'0'.repeat(24)}${stripHexPrefix(address.toLowerCase())}`;
}
function encodeBytes(dataHex) {
    if (!dataHex.startsWith('0x')) {
        throw new Error('Bytes value must be 0x-prefixed hex');
    }
    const payload = stripHexPrefix(dataHex);
    if (payload.length % 2 !== 0) {
        throw new Error('Hex payload must have an even number of characters');
    }
    const byteLength = BigInt(payload.length / 2);
    const paddedBytes = Number(((byteLength + 31n) / 32n) * 32n);
    const paddedHex = payload.padEnd(paddedBytes * 2, '0');
    return `${encodeUint256(byteLength)}${paddedHex}`;
}
function encodeAggregate3Call(calls) {
    const argHead = encodeUint256(32n);
    const n = calls.length;
    const offsets = [];
    const encodedElements = [];
    let runningOffset = BigInt(n * 32);
    for (const call of calls) {
        const encodedCallData = encodeBytes(call.callData);
        const element = encodeAddress(call.target) +
            encodeBool(call.allowFailure) +
            encodeUint256(96n) +
            encodedCallData;
        offsets.push(encodeUint256(runningOffset));
        encodedElements.push(element);
        runningOffset += BigInt(element.length / 2);
    }
    const arrayBody = `${encodeUint256(BigInt(n))}${offsets.join('')}${encodedElements.join('')}`;
    return `0x${MULTICALL3_AGGREGATE3_SELECTOR}${argHead}${arrayBody}`;
}
function readWord(data, offset) {
    if (offset < 0 || offset + 32 > data.length) {
        throw new Error('Out-of-bounds ABI read');
    }
    return BigInt(`0x${data.subarray(offset, offset + 32).toString('hex')}`);
}
function decodeAggregate3Result(resultHex) {
    if (!resultHex.startsWith('0x')) {
        throw new Error('Invalid aggregate3 return');
    }
    const payloadHex = stripHexPrefix(resultHex);
    if (payloadHex.length % 2 !== 0) {
        throw new Error('Invalid aggregate3 return length');
    }
    const data = Buffer.from(payloadHex, 'hex');
    const arrStart = Number(readWord(data, 0));
    const n = Number(readWord(data, arrStart));
    const headStart = arrStart + 32;
    const out = [];
    for (let i = 0; i < n; i += 1) {
        const elemRel = Number(readWord(data, headStart + i * 32));
        const elemStart = headStart + elemRel;
        const success = readWord(data, elemStart) !== 0n;
        const bytesRel = Number(readWord(data, elemStart + 32));
        const bytesStart = elemStart + bytesRel;
        const bytesLength = Number(readWord(data, bytesStart));
        const bytesDataStart = bytesStart + 32;
        const bytesDataEnd = bytesDataStart + bytesLength;
        if (bytesDataEnd > data.length) {
            throw new Error('Invalid bytes bounds in aggregate3 return');
        }
        out.push({
            success,
            data: data.subarray(bytesDataStart, bytesDataEnd)
        });
    }
    return out;
}
async function jsonRpcCall(rpcUrl, method, params, requestId) {
    const payload = {
        jsonrpc: '2.0',
        id: requestId,
        method,
        params
    };
    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000)
    });
    const body = await response.text();
    if (!response.ok) {
        throw new Error(`HTTP error ${response.status} from RPC endpoint: ${body}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        throw new Error(`Invalid JSON-RPC response: ${body}`);
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid JSON-RPC response object');
    }
    const parsedObj = parsed;
    if (parsedObj.error !== undefined) {
        throw new Error(`JSON-RPC error from ${method}: ${JSON.stringify(parsedObj.error)}`);
    }
    if (parsedObj.result === undefined) {
        throw new Error('JSON-RPC response missing result field');
    }
    return parsedObj.result;
}
function normalizeHexValue(value) {
    return `0x${BigInt(value).toString(16)}`;
}
function slotToWord(slotHex) {
    return stripHexPrefix(slotHex).padStart(64, '0');
}
function buildJobs(storageInput) {
    const jobs = [];
    for (const [address, slots] of Object.entries(storageInput)) {
        const normalizedSlots = [];
        for (const slot of slots) {
            try {
                normalizedSlots.push(normalizeSlot(slot));
            }
            catch {
                // Keep extraction best-effort for malformed slots.
            }
        }
        for (let index = 0; index < normalizedSlots.length; index += MAX_BATCH_SIZE) {
            const batchSlots = normalizedSlots.slice(index, index + MAX_BATCH_SIZE);
            jobs.push({ address, slots: batchSlots });
        }
    }
    return jobs;
}
async function extractStorageValues(rpcUrl, storageInput, blockIdentifier) {
    const output = {};
    for (const address of Object.keys(storageInput)) {
        output[address] = {};
    }
    const jobs = buildJobs(storageInput);
    const requestedAddressCount = Object.keys(storageInput).length;
    const requestedSlotCount = jobs.reduce((count, job) => count + job.slots.length, 0);
    debug(`Storage extractor request prepared: ${requestedAddressCount} address(es), ${requestedSlotCount} slot(s), ${jobs.length} batch job(s), block ${blockIdentifier}`);
    let requestId = 1;
    let cursor = 0;
    while (cursor < jobs.length) {
        const batchJobs = [];
        let slotCount = 0;
        while (cursor < jobs.length) {
            const candidate = jobs[cursor];
            if (candidate.slots.length === 0) {
                cursor += 1;
                continue;
            }
            if (slotCount + candidate.slots.length > MAX_BATCH_SIZE) {
                break;
            }
            batchJobs.push(candidate);
            slotCount += candidate.slots.length;
            cursor += 1;
            if (slotCount >= MAX_BATCH_SIZE) {
                break;
            }
        }
        if (batchJobs.length === 0) {
            continue;
        }
        const batchAddressCount = batchJobs.length;
        const batchSlotCount = batchJobs.reduce((count, job) => count + job.slots.length, 0);
        debug(`Processing extraction batch: ${batchAddressCount} address(es), ${batchSlotCount} slot(s)`);
        const calls = [];
        const stateOverrides = {};
        for (const { address, slots } of batchJobs) {
            const callData = `0x${slots.map(slotToWord).join('')}`;
            calls.push({
                target: address,
                allowFailure: true,
                callData
            });
            stateOverrides[address] = { code: OVERRIDE_STORAGE_READER_CODE };
        }
        let multicallCalldata;
        try {
            multicallCalldata = encodeAggregate3Call(calls);
        }
        catch {
            continue;
        }
        const payloadParams = [
            {
                to: MULTICALL3_ADDRESS,
                data: multicallCalldata
            },
            blockIdentifier,
            stateOverrides
        ];
        let rpcResult;
        let rpcSuccess = false;
        let rpcFailureReason;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
            requestId += 1;
            try {
                rpcResult = await jsonRpcCall(rpcUrl, 'eth_call', payloadParams, requestId);
                rpcSuccess = true;
                break;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                rpcFailureReason = message;
                debug(`eth_call attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`);
                await sleep(150 * (attempt + 1));
            }
        }
        if (!rpcSuccess ||
            typeof rpcResult !== 'string' ||
            !rpcResult.startsWith('0x')) {
            debug(`Skipping batch after eth_call failure. Last reason: ${rpcFailureReason ?? 'missing/invalid result'}`);
            continue;
        }
        let decoded;
        try {
            decoded = decodeAggregate3Result(rpcResult);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            debug(`Failed to decode aggregate3 result: ${message}`);
            continue;
        }
        const callCount = Math.min(decoded.length, batchJobs.length);
        let extractedInBatch = 0;
        for (let index = 0; index < callCount; index += 1) {
            const { success, data } = decoded[index];
            if (!success) {
                debug(`aggregate3 call ${index} returned success=false`);
                continue;
            }
            const { address, slots } = batchJobs[index];
            const expectedLength = slots.length * 32;
            if (data.length < expectedLength) {
                debug(`aggregate3 call ${index} returned ${data.length} bytes, expected at least ${expectedLength}`);
                continue;
            }
            for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
                const start = slotIndex * 32;
                const end = start + 32;
                if (end > data.length) {
                    break;
                }
                const word = data.subarray(start, end);
                output[address][slots[slotIndex]] = normalizeHexValue(`0x${word.toString('hex')}`);
                extractedInBatch += 1;
            }
        }
        debug(`Finished extraction batch: extracted ${extractedInBatch} slot value(s) across ${callCount} decoded call(s)`);
    }
    const totalExtracted = Object.values(output).reduce((count, slotMap) => count + Object.keys(slotMap).length, 0);
    debug(`Storage extractor completed: extracted ${totalExtracted}/${requestedSlotCount} requested slot(s)`);
    return output;
}

async function writeStorageValues(chain, block, values) {
    const outputDir = join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.foundry', 'cache', 'foundry-cache-boost', 'storage-values', chain);
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${block}.json`);
    const rendered = `${JSON.stringify({ storage: values }, null, 2)}\n`;
    await writeFile(outputPath, rendered, 'utf-8');
}
/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
async function run() {
    try {
        const rawBlock = getInput('block', { required: true });
        const rpcEndpointsJson = getInput('rpc-endpoints-json', {
            required: true
        });
        const cacheKeyPrefix = getInput('cache-key-prefix') || 'foundry-cache-boost';
        const block = normalizeBlockIdentifier(rawBlock);
        const rpcEndpoints = parseRpcEndpointsJson(rpcEndpointsJson);
        await ensureBoostCacheDir();
        const cachePath = getSlotHintsPath();
        const cacheKeys = buildCacheKeys(cacheKeyPrefix);
        const matchedKey = await cacheExports.restoreCache([cachePath], cacheKeys.primaryKey, cacheKeys.restoreKeys);
        saveState(CACHE_PRIMARY_KEY_STATE, cacheKeys.primaryKey);
        saveState(CACHE_MATCHED_KEY_STATE, matchedKey ?? '');
        if (matchedKey) {
            info(`Restored slot hints from cache key: ${matchedKey}`);
        }
        else {
            info('No slot hints cache hit found; continuing with fresh retrieval');
        }
        const slotHints = await readSlotHintsFile();
        for (const [chain, rpcUrl] of Object.entries(rpcEndpoints)) {
            const hintsForChain = slotHints?.chains[chain];
            const requested = hintsForChain ?? {};
            const requestedAddressCount = Object.keys(requested).length;
            const requestedSlotCount = Object.values(requested).reduce((count, slots) => count + slots.length, 0);
            debug(`Chain ${chain} requested from cache hints: ${requestedAddressCount} address(es), ${requestedSlotCount} slot(s)`);
            if (Object.keys(requested).length === 0) {
                info(`Skipping chain ${chain}: no slots requested`);
                continue;
            }
            const values = await extractStorageValues(rpcUrl, requested, block);
            await writeStorageValues(chain, block, values);
            const addressCount = Object.keys(values).length;
            const slotCount = Object.values(values).reduce((count, slotMap) => count + Object.keys(slotMap).length, 0);
            info(`Retrieved ${slotCount} slot values across ${addressCount} address(es) for chain ${chain}`);
        }
        info(`Completed storage retrieval for block ${block}`);
    }
    catch (error) {
        // Fail the workflow run if an error occurs
        if (error instanceof Error)
            setFailed(error.message);
    }
}

/**
 * The entrypoint for the action. This file simply imports and runs the action's
 * main logic.
 */
/* istanbul ignore next */
run();
//# sourceMappingURL=index.js.map
