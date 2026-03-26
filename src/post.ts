import * as core from '@actions/core'
import * as cache from '@actions/cache'
import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import {
  CACHE_MATCHED_KEY_STATE,
  CACHE_PRIMARY_KEY_STATE,
  getCacheWindow,
  getSlotHintsPath,
  writeSlotHintsFile
} from './cache-utils.js'
import { isBlockWithinWindow, parseBlockConfig, parseNumericBlock, resolveBlockForChain } from './input-utils.js'

function extractFileBlockNumber(fileName: string): bigint | undefined {
  const stem = basename(fileName, '.json')
  if (/^\d+$/.test(stem)) {
    return BigInt(stem)
  }

  if (/^0x[0-9a-fA-F]+$/.test(stem)) {
    return BigInt(stem)
  }

  return undefined
}

function addSlotsFromStorageMap(chainMap: Record<string, Set<string>>, storage: unknown): void {
  if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
    return
  }

  for (const [address, slotsValue] of Object.entries(storage)) {
    if (!slotsValue || typeof slotsValue !== 'object' || Array.isArray(slotsValue)) {
      continue
    }

    if (!chainMap[address]) {
      chainMap[address] = new Set<string>()
    }

    for (const slot of Object.keys(slotsValue)) {
      chainMap[address].add(slot)
    }
  }
}

function toSerializableChains(
  aggregate: Record<string, Record<string, Set<string>>>
): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {}

  for (const [chain, addresses] of Object.entries(aggregate)) {
    out[chain] = {}
    for (const [address, slotsSet] of Object.entries(addresses)) {
      out[chain][address] = Array.from(slotsSet).sort()
    }
  }

  return out
}

/**
 * Post-job entrypoint.
 *
 * Aggregates used storage slots from the Foundry RPC cache tree and persists
 * them into GitHub Actions cache for the next run.
 */
export async function runPost(): Promise<void> {
  const rpcCacheDir = join(homedir(), '.foundry', 'cache', 'rpc')
  const blockConfig = parseBlockConfig(core.getInput('block', { required: true }))
  const windowSize = getCacheWindow()

  try {
    const chainEntries = await readdir(rpcCacheDir, { withFileTypes: true })

    if (chainEntries.length === 0) {
      core.info(`No chain directories found in ${rpcCacheDir}`)
      return
    }

    const aggregate: Record<string, Record<string, Set<string>>> = {}

    for (const chainEntry of chainEntries) {
      if (!chainEntry.isDirectory()) {
        continue
      }

      const chainName = chainEntry.name
      if (blockConfig.blocksByChain[chainName] === undefined && blockConfig.defaultBlock === undefined) {
        core.info(
          `Skipping chain directory ${chainName}: no block mapping for this chain and no default block is configured`
        )
        continue
      }

      const blockForChain = resolveBlockForChain(blockConfig, chainName)
      const numericBlockForChain = parseNumericBlock(blockForChain)
      const chainPath = join(rpcCacheDir, chainName)
      const children = await readdir(chainPath, { withFileTypes: true })

      for (const child of children) {
        if (!child.isFile()) {
          continue
        }

        if (numericBlockForChain !== undefined) {
          const fileBlock = extractFileBlockNumber(child.name)
          if (fileBlock === undefined || !isBlockWithinWindow(fileBlock, numericBlockForChain, windowSize)) {
            continue
          }
        }

        const filePath = join(chainPath, child.name)

        let parsed: unknown
        try {
          parsed = JSON.parse(await readFile(filePath, 'utf-8'))
        } catch {
          continue
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          continue
        }

        const root = parsed as Record<string, unknown>
        if (!aggregate[chainName]) {
          aggregate[chainName] = {}
        }

        addSlotsFromStorageMap(aggregate[chainName], root.storage)
      }
    }

    const serializable = toSerializableChains(aggregate)
    const metaBase = {
      generatedAt: new Date().toISOString(),
      window: Number(windowSize)
    }

    await writeSlotHintsFile(
      blockConfig.defaultBlock === undefined
        ? {
            chains: serializable,
            meta: {
              ...metaBase,
              blocksByChain: blockConfig.blocksByChain
            }
          }
        : {
            chains: serializable,
            meta: {
              ...metaBase,
              block: blockConfig.defaultBlock
            }
          }
    )

    const primaryKey = core.getState(CACHE_PRIMARY_KEY_STATE)
    const matchedKey = core.getState(CACHE_MATCHED_KEY_STATE)
    if (!primaryKey) {
      core.warning('Skipping slot hints cache save: missing primary key state')
      return
    }

    if (matchedKey && matchedKey === primaryKey) {
      core.info(`Skipping save; cache key already matched: ${matchedKey}`)
      return
    }

    await cache.saveCache([getSlotHintsPath()], primaryKey)
    core.info(`Saved slot hints cache with key: ${primaryKey}`)
  } catch (error) {
    const ioError = error as NodeJS.ErrnoException
    if (ioError.code === 'ENOENT') {
      core.info(`Foundry RPC cache directory does not exist: ${rpcCacheDir}`)
      return
    }

    if (error instanceof Error) core.setFailed(error.message)
  }
}
