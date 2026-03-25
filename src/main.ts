import * as core from '@actions/core'
import * as cache from '@actions/cache'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CACHE_MATCHED_KEY_STATE,
  CACHE_PRIMARY_KEY_STATE,
  buildCacheKeys,
  ensureBoostCacheDir,
  getSlotHintsPath,
  readSlotHintsFile
} from './cache-utils.js'
import { normalizeBlockIdentifier, parseRpcEndpointsJson } from './input-utils.js'
import { extractStorageValues } from './storage-extractor.js'

type SlotValuesByAddress = Record<string, Record<string, string>>

function parseStorageField(storage: unknown): SlotValuesByAddress {
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
    return {}
  }

  const parsed: SlotValuesByAddress = {}

  for (const [address, slotsValue] of Object.entries(storage)) {
    if (!slotsValue || typeof slotsValue !== 'object' || Array.isArray(slotsValue)) {
      continue
    }

    parsed[address] = {}
    for (const [slot, value] of Object.entries(slotsValue)) {
      if (typeof value === 'string') {
        parsed[address][slot] = value
      }
    }
  }

  return parsed
}

function mergeStorageValues(existing: SlotValuesByAddress, fetched: SlotValuesByAddress): SlotValuesByAddress {
  const merged: SlotValuesByAddress = {}

  for (const [address, slots] of Object.entries(existing)) {
    merged[address] = { ...slots }
  }

  for (const [address, slots] of Object.entries(fetched)) {
    if (!merged[address]) {
      merged[address] = {}
    }

    for (const [slot, value] of Object.entries(slots)) {
      merged[address][slot] = value
    }
  }

  return merged
}

async function jsonRpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    }),
    signal: AbortSignal.timeout(30_000)
  })

  const body = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP error ${response.status} from RPC endpoint: ${body}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error(`Invalid JSON-RPC response: ${body}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON-RPC response object')
  }

  const parsedObj = parsed as {
    error?: unknown
    result?: unknown
  }

  if (parsedObj.error !== undefined) {
    throw new Error(`JSON-RPC error from ${method}: ${JSON.stringify(parsedObj.error)}`)
  }

  if (parsedObj.result === undefined) {
    throw new Error('JSON-RPC response missing result field')
  }

  return parsedObj.result
}

async function resolveConcreteBlock(rpcUrl: string, blockIdentifier: string): Promise<string> {
  if (/^0x[0-9a-f]+$/i.test(blockIdentifier) || /^\d+$/.test(blockIdentifier)) {
    return blockIdentifier
  }

  const blockResult = await jsonRpcCall(rpcUrl, 'eth_getBlockByNumber', [blockIdentifier, false])

  if (!blockResult || typeof blockResult !== 'object') {
    throw new Error(`Unable to resolve block tag ${blockIdentifier}: RPC returned invalid block payload`)
  }

  const blockObject = blockResult as { number?: unknown }
  if (typeof blockObject.number !== 'string') {
    throw new Error(`Unable to resolve block tag ${blockIdentifier}: missing block number`)
  }

  return `0x${BigInt(blockObject.number).toString(16)}`
}

async function writeStorageValues(chain: string, block: string, values: SlotValuesByAddress): Promise<void> {
  const outputDir = join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.foundry', 'cache', 'rpc', chain)
  await mkdir(outputDir, { recursive: true })

  const outputPath = join(outputDir, block)
  let outputRoot: Record<string, unknown> = {}

  try {
    const outputPathStats = await stat(outputPath)
    if (outputPathStats.isDirectory()) {
      core.info(`Skipping ${outputPath}: path is a directory`)
      return
    }

    if (!outputPathStats.isFile()) {
      core.info(`Skipping ${outputPath}: path is not a regular file`)
      return
    }

    let existingRaw: string
    try {
      existingRaw = await readFile(outputPath, 'utf-8')
    } catch {
      core.info(`Skipping ${outputPath}: file is unreadable`)
      return
    }

    let existingParsed: unknown
    try {
      existingParsed = JSON.parse(existingRaw)
    } catch {
      core.info(`Skipping ${outputPath}: malformed JSON`)
      return
    }

    if (!existingParsed || typeof existingParsed !== 'object' || Array.isArray(existingParsed)) {
      core.info(`Skipping ${outputPath}: expected JSON object at root`)
      return
    }

    outputRoot = existingParsed as Record<string, unknown>
  } catch (error) {
    const ioError = error as NodeJS.ErrnoException
    if (ioError.code !== 'ENOENT') {
      core.info(`Skipping ${outputPath}: unable to access existing path`)
      return
    }
  }

  const existingStorage = parseStorageField(outputRoot.storage)
  const mergedStorage = mergeStorageValues(existingStorage, values)
  const rendered = `${JSON.stringify({ ...outputRoot, storage: mergedStorage }, null, 2)}\n`
  await writeFile(outputPath, rendered, 'utf-8')
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const rawBlock: string = core.getInput('block', { required: true })
    const rpcEndpointsJson: string = core.getInput('rpc-endpoints-json', {
      required: true
    })
    const cacheKeyPrefix: string = core.getInput('cache-key-prefix') || 'foundry-cache-boost'

    const block = normalizeBlockIdentifier(rawBlock)
    const rpcEndpoints = parseRpcEndpointsJson(rpcEndpointsJson)

    await ensureBoostCacheDir()

    const cachePath = getSlotHintsPath()
    const cacheKeys = buildCacheKeys(cacheKeyPrefix)
    const matchedKey = await cache.restoreCache([cachePath], cacheKeys.primaryKey, cacheKeys.restoreKeys)

    core.saveState(CACHE_PRIMARY_KEY_STATE, cacheKeys.primaryKey)
    core.saveState(CACHE_MATCHED_KEY_STATE, matchedKey ?? '')

    if (matchedKey) {
      core.info(`Restored slot hints from cache key: ${matchedKey}`)
    } else {
      core.info('No slot hints cache hit found; continuing with fresh retrieval')
    }

    const slotHints = await readSlotHintsFile()

    for (const [chain, rpcUrl] of Object.entries(rpcEndpoints)) {
      const hintsForChain = slotHints?.chains[chain]
      const requested = hintsForChain ?? {}
      const requestedAddressCount = Object.keys(requested).length
      const requestedSlotCount = Object.values(requested).reduce((count, slots) => count + slots.length, 0)

      core.debug(
        `Chain ${chain} requested from cache hints: ${requestedAddressCount} address(es), ${requestedSlotCount} slot(s)`
      )

      if (Object.keys(requested).length === 0) {
        core.info(`Skipping chain ${chain}: no slots requested`)
        continue
      }

      const concreteBlock = await resolveConcreteBlock(rpcUrl, block)

      const values = await extractStorageValues(rpcUrl, requested, concreteBlock)
      await writeStorageValues(chain, concreteBlock, values)

      const addressCount = Object.keys(values).length
      const slotCount = Object.values(values).reduce((count, slotMap) => count + Object.keys(slotMap).length, 0)

      core.info(`Retrieved ${slotCount} slot values across ${addressCount} address(es) for chain ${chain}`)
    }

    core.info(`Completed storage retrieval for block ${block}`)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
