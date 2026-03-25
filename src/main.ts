import * as core from '@actions/core'
import * as cache from '@actions/cache'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CACHE_MATCHED_KEY_STATE,
  CACHE_PRIMARY_KEY_STATE,
  buildCacheKeys,
  ensureBoostCacheDir,
  getSlotHintsPath,
  readSlotHintsFile
} from './cache-utils.js'
import {
  getChainStorageRequest,
  normalizeBlockIdentifier,
  parseRpcEndpointsJson,
  readStorageInputFile
} from './input-utils.js'
import { extractStorageValues } from './storage-extractor.js'

function mergeSlots(
  base: Record<string, unknown[]>,
  hinted: Record<string, string[]> | undefined
): Record<string, unknown[]> {
  const merged: Record<string, unknown[]> = { ...base }

  if (!hinted) {
    return merged
  }

  for (const [address, slots] of Object.entries(hinted)) {
    const existing = Array.isArray(merged[address]) ? merged[address] : []
    merged[address] = Array.from(new Set([...existing, ...slots]))
  }

  return merged
}

async function writeStorageValues(
  chain: string,
  block: string,
  values: Record<string, Record<string, string>>
): Promise<void> {
  const outputDir = join(
    process.env.HOME ?? process.env.USERPROFILE ?? '.',
    '.foundry',
    'cache',
    'foundry-cache-boost',
    'storage-values',
    chain
  )
  await mkdir(outputDir, { recursive: true })

  const outputPath = join(outputDir, `${block}.json`)
  const rendered = `${JSON.stringify({ storage: values }, null, 2)}\n`
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
    const storageInputPath: string = core.getInput('storage-input-path', {
      required: true
    })
    const rpcEndpointsJson: string = core.getInput('rpc-endpoints-json', {
      required: true
    })
    const cacheKeyPrefix: string =
      core.getInput('cache-key-prefix') || 'foundry-cache-boost'

    const block = normalizeBlockIdentifier(rawBlock)
    const rpcEndpoints = parseRpcEndpointsJson(rpcEndpointsJson)
    const storageInput = await readStorageInputFile(storageInputPath)

    await ensureBoostCacheDir()

    const cachePath = getSlotHintsPath()
    const cacheKeys = buildCacheKeys(cacheKeyPrefix)
    const matchedKey = await cache.restoreCache(
      [cachePath],
      cacheKeys.primaryKey,
      cacheKeys.restoreKeys
    )

    core.saveState(CACHE_PRIMARY_KEY_STATE, cacheKeys.primaryKey)
    core.saveState(CACHE_MATCHED_KEY_STATE, matchedKey ?? '')

    if (matchedKey) {
      core.info(`Restored slot hints from cache key: ${matchedKey}`)
    } else {
      core.info(
        'No slot hints cache hit found; continuing with fresh retrieval'
      )
    }

    const slotHints = await readSlotHintsFile()

    for (const [chain, rpcUrl] of Object.entries(rpcEndpoints)) {
      const requested = getChainStorageRequest(storageInput, chain)
      const hintsForChain = slotHints?.chains[chain]
      const mergedRequest = mergeSlots(requested, hintsForChain)

      if (Object.keys(mergedRequest).length === 0) {
        core.info(`Skipping chain ${chain}: no slots requested`)
        continue
      }

      const values = await extractStorageValues(rpcUrl, mergedRequest, block)
      await writeStorageValues(chain, block, values)

      const addressCount = Object.keys(values).length
      const slotCount = Object.values(values).reduce(
        (count, slotMap) => count + Object.keys(slotMap).length,
        0
      )

      core.info(
        `Retrieved ${slotCount} slot values across ${addressCount} address(es) for chain ${chain}`
      )
    }

    core.info(`Completed storage retrieval for block ${block}`)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
