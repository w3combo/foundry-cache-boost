import { a as normalizeBlockIdentifier, g as getInput, l as parseNumericBlock, i as info, m as isBlockWithinWindow, w as writeSlotHintsFile, o as getState, C as CACHE_PRIMARY_KEY_STATE, f as CACHE_MATCHED_KEY_STATE, q as warning, d as cacheExports, b as getSlotHintsPath, k as setFailed, t as getCacheWindow } from './input-utils-Bu0Y0prN.js';
import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import 'os';
import 'crypto';
import 'fs';
import 'path';
import 'http';
import 'https';
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
import 'string_decoder';
import 'events';
import 'child_process';
import 'assert';
import 'timers';
import 'net';
import 'tls';
import 'util';
import 'stream';
import 'buffer';
import 'querystring';
import 'stream/web';
import 'worker_threads';
import 'perf_hooks';
import 'util/types';
import 'async_hooks';
import 'console';
import 'url';
import 'zlib';
import 'diagnostics_channel';
import 'node:process';
import 'node:https';
import 'tty';
import 'node:crypto';
import 'node:fs';

function extractFileBlockNumber(fileName) {
    const stem = basename(fileName, '.json');
    if (/^\d+$/.test(stem)) {
        return BigInt(stem);
    }
    if (/^0x[0-9a-fA-F]+$/.test(stem)) {
        return BigInt(stem);
    }
    return undefined;
}
function addSlotsFromStorageMap(chainMap, storage) {
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
        return;
    }
    for (const [address, slotsValue] of Object.entries(storage)) {
        if (!slotsValue ||
            typeof slotsValue !== 'object' ||
            Array.isArray(slotsValue)) {
            continue;
        }
        if (!chainMap[address]) {
            chainMap[address] = new Set();
        }
        for (const slot of Object.keys(slotsValue)) {
            chainMap[address].add(slot);
        }
    }
}
function toSerializableChains(aggregate) {
    const out = {};
    for (const [chain, addresses] of Object.entries(aggregate)) {
        out[chain] = {};
        for (const [address, slotsSet] of Object.entries(addresses)) {
            out[chain][address] = Array.from(slotsSet).sort();
        }
    }
    return out;
}
/**
 * Post-job entrypoint.
 *
 * Aggregates used storage slots from the Foundry RPC cache tree and persists
 * them into GitHub Actions cache for the next run.
 */
async function runPost() {
    const rpcCacheDir = join(homedir(), '.foundry', 'cache', 'rpc');
    const block = normalizeBlockIdentifier(getInput('block', { required: true }));
    const numericBlock = parseNumericBlock(block);
    const windowSize = getCacheWindow();
    try {
        const chainEntries = await readdir(rpcCacheDir, { withFileTypes: true });
        if (chainEntries.length === 0) {
            info(`No chain directories found in ${rpcCacheDir}`);
            return;
        }
        const aggregate = {};
        for (const chainEntry of chainEntries) {
            if (!chainEntry.isDirectory()) {
                continue;
            }
            const chainName = chainEntry.name;
            const chainPath = join(rpcCacheDir, chainName);
            const children = await readdir(chainPath, { withFileTypes: true });
            for (const child of children) {
                if (!child.isFile()) {
                    continue;
                }
                if (numericBlock !== undefined) {
                    const fileBlock = extractFileBlockNumber(child.name);
                    if (fileBlock === undefined ||
                        !isBlockWithinWindow(fileBlock, numericBlock, windowSize)) {
                        continue;
                    }
                }
                const filePath = join(chainPath, child.name);
                let parsed;
                try {
                    parsed = JSON.parse(await readFile(filePath, 'utf-8'));
                }
                catch {
                    continue;
                }
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    continue;
                }
                const root = parsed;
                if (!aggregate[chainName]) {
                    aggregate[chainName] = {};
                }
                addSlotsFromStorageMap(aggregate[chainName], root.storage);
            }
        }
        const serializable = toSerializableChains(aggregate);
        await writeSlotHintsFile({
            chains: serializable,
            meta: {
                generatedAt: new Date().toISOString(),
                block,
                window: Number(windowSize)
            }
        });
        const primaryKey = getState(CACHE_PRIMARY_KEY_STATE);
        const matchedKey = getState(CACHE_MATCHED_KEY_STATE);
        if (!primaryKey) {
            warning('Skipping slot hints cache save: missing primary key state');
            return;
        }
        if (matchedKey && matchedKey === primaryKey) {
            info(`Skipping save; cache key already matched: ${matchedKey}`);
            return;
        }
        await cacheExports.saveCache([getSlotHintsPath()], primaryKey);
        info(`Saved slot hints cache with key: ${primaryKey}`);
    }
    catch (error) {
        const ioError = error;
        if (ioError.code === 'ENOENT') {
            info(`Foundry RPC cache directory does not exist: ${rpcCacheDir}`);
            return;
        }
        if (error instanceof Error)
            setFailed(error.message);
    }
}

/* istanbul ignore next */
void runPost();
//# sourceMappingURL=post.js.map
