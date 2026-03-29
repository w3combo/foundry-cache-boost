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
import { parseBlockConfig, parseRpcEndpointsJson, resolveBlockForChain } from './input-utils.js'
import { extractStorageValues } from './storage-extractor.js'

type SlotValuesByAddress = Record<string, Record<string, string>>
type JsonObject = Record<string, unknown>

type RpcBlockPayload = {
  number?: unknown
  miner?: unknown
  timestamp?: unknown
  gasLimit?: unknown
  baseFeePerGas?: unknown
  difficulty?: unknown
  prevRandao?: unknown
  mixHash?: unknown
  excessBlobGas?: unknown
}

const ETHEREUM_MAINNET_CHAIN_ID = 1n
const MAINNET_MERGE_BLOCK = 15_537_351n
const BSC_MAINNET_CHAIN_ID = 56n
const BSC_TESTNET_CHAIN_ID = 97n

type BlockEnv = {
  number: string
  beneficiary: string
  timestamp: string
  gas_limit: number
  basefee: number
  difficulty: string
  prevrandao: string
  blob_excess_gas_and_price: {
    excess_blob_gas: number
    blob_gasprice: number
  }
}

type ResolvedBlockContext = {
  blockHex: string
  blockEnv: BlockEnv
}

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeHexString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }

  if (!value.startsWith('0x')) {
    return fallback
  }

  try {
    return `0x${BigInt(value).toString(16)}`
  } catch {
    return fallback
  }
}

function normalizeB256(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('0x')) {
    return fallback
  }

  try {
    const parsed = BigInt(value)
    return `0x${parsed.toString(16).padStart(64, '0')}`
  } catch {
    return fallback
  }
}

function toHexBlockTag(blockIdentifier: string): string {
  if (/^0x[0-9a-f]+$/i.test(blockIdentifier)) {
    return `0x${BigInt(blockIdentifier).toString(16)}`
  }

  if (/^\d+$/.test(blockIdentifier)) {
    return `0x${BigInt(blockIdentifier).toString(16)}`
  }

  return blockIdentifier
}

function normalizeAddress(value: unknown): string {
  if (typeof value !== 'string') {
    return ADDRESS_ZERO
  }

  const lowered = value.toLowerCase()
  if (/^0x[0-9a-f]{40}$/.test(lowered)) {
    return lowered
  }

  return ADDRESS_ZERO
}

function hexToNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'string' || !value.startsWith('0x')) {
    return fallback
  }

  try {
    const parsed = Number(BigInt(value))
    if (Number.isNaN(parsed)) {
      return fallback
    }
    return parsed
  } catch {
    return fallback
  }
}

function hexToBigInt(value: string): bigint {
  return BigInt(value)
}

function toHex(value: bigint): string {
  return `0x${value.toString(16)}`
}

function toB256Hex(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`
}

function buildBlockEnv(
  block: RpcBlockPayload,
  blobBaseFeeHex: string | undefined,
  chainId: bigint | undefined
): BlockEnv {
  const numberHex = normalizeHexString(block.number, '0x0')
  const rawDifficultyHex = normalizeHexString(block.difficulty, '0x0')
  const rawPrevrandaoHex = normalizeB256(block.prevRandao ?? block.mixHash, `0x${'0'.repeat(64)}`)

  let effectiveDifficulty = hexToBigInt(rawDifficultyHex)
  let effectivePrevrandao = hexToBigInt(rawPrevrandaoHex)

  if (chainId === BSC_MAINNET_CHAIN_ID || chainId === BSC_TESTNET_CHAIN_ID) {
    // Foundry maps BSC difficulty into prevrandao because mixHash/prevrandao is unreliable there.
    effectivePrevrandao = effectiveDifficulty
  }

  const blockNumber = hexToBigInt(numberHex)
  if (chainId === ETHEREUM_MAINNET_CHAIN_ID && blockNumber >= MAINNET_MERGE_BLOCK) {
    // Foundry maps post-merge mainnet difficulty to prevrandao.
    effectiveDifficulty = effectivePrevrandao
  }

  if (effectiveDifficulty === 0n) {
    // Foundry also applies this fallback when difficulty is zero.
    effectiveDifficulty = effectivePrevrandao
  }

  return {
    number: numberHex,
    beneficiary: normalizeAddress(block.miner),
    timestamp: normalizeHexString(block.timestamp, '0x0'),
    gas_limit: hexToNumber(block.gasLimit, 0),
    basefee: hexToNumber(block.baseFeePerGas, 0),
    difficulty: toHex(effectiveDifficulty),
    prevrandao: toB256Hex(effectivePrevrandao),
    blob_excess_gas_and_price: {
      excess_blob_gas: hexToNumber(block.excessBlobGas, 0),
      blob_gasprice: blobBaseFeeHex === undefined ? 1 : hexToNumber(blobBaseFeeHex, 1)
    }
  }
}

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

async function fetchBlobBaseFee(rpcUrl: string): Promise<string | undefined> {
  try {
    const result = await jsonRpcCall(rpcUrl, 'eth_blobBaseFee', [])
    if (typeof result !== 'string') {
      return undefined
    }
    return normalizeHexString(result, '0x1')
  } catch {
    return undefined
  }
}

async function fetchChainId(rpcUrl: string): Promise<bigint | undefined> {
  try {
    const result = await jsonRpcCall(rpcUrl, 'eth_chainId', [])
    if (typeof result !== 'string') {
      return undefined
    }

    return BigInt(result)
  } catch {
    return undefined
  }
}

async function resolveConcreteBlock(rpcUrl: string, blockIdentifier: string): Promise<ResolvedBlockContext> {
  const blockTag = toHexBlockTag(blockIdentifier)
  const blockResult = await jsonRpcCall(rpcUrl, 'eth_getBlockByNumber', [blockTag, false])

  if (!blockResult || typeof blockResult !== 'object') {
    throw new Error(`Unable to resolve block tag ${blockIdentifier}: RPC returned invalid block payload`)
  }

  const blockObject = blockResult as RpcBlockPayload
  if (typeof blockObject.number !== 'string') {
    throw new Error(`Unable to resolve block tag ${blockIdentifier}: missing block number`)
  }

  const normalizedBlockHex = normalizeHexString(blockObject.number, '0x0')
  const blobBaseFeeHex = await fetchBlobBaseFee(rpcUrl)
  const chainId = await fetchChainId(rpcUrl)

  return {
    blockHex: normalizedBlockHex,
    blockEnv: buildBlockEnv(blockObject, blobBaseFeeHex, chainId)
  }
}

async function writeStorageValues(
  chain: string,
  blockNumber: bigint,
  values: SlotValuesByAddress,
  blockEnv: BlockEnv
): Promise<void> {
  const outputDir = join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.foundry', 'cache', 'rpc', chain)
  await mkdir(outputDir, { recursive: true })

  const outputPath = join(outputDir, blockNumber.toString(10))
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
  const existingMeta = isRecord(outputRoot.meta) ? outputRoot.meta : {}
  const rendered = `${JSON.stringify(
    {
      ...outputRoot,
      meta: {
        ...existingMeta,
        block_env: blockEnv,
        hosts: ['localhost']
      },
      accounts: {},
      block_hashes: {},
      storage: mergedStorage
    },
    null,
    2
  )}\n`
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

    const blockConfig = parseBlockConfig(rawBlock)
    const rpcEndpoints = parseRpcEndpointsJson(rpcEndpointsJson)
    const resolvedBlockNumbersByChain: Record<string, string> = {}

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
      const chainBlockIdentifier = resolveBlockForChain(blockConfig, chain)
      const hintsForChain = slotHints?.chains[chain]
      const requested = hintsForChain ?? {}
      const requestedAddressCount = Object.keys(requested).length
      const requestedSlotCount = Object.values(requested).reduce((count, slots) => count + slots.length, 0)

      core.debug(
        `Chain ${chain} requested from cache hints: ${requestedAddressCount} address(es), ${requestedSlotCount} slot(s)`
      )

      const resolvedBlock = await resolveConcreteBlock(rpcUrl, chainBlockIdentifier)
      const concreteBlockNumber = BigInt(resolvedBlock.blockHex)
      resolvedBlockNumbersByChain[chain] = concreteBlockNumber.toString(10)

      if (Object.keys(requested).length === 0) {
        core.info(`Skipping chain ${chain}: no slots requested`)
        continue
      }

      const values = await extractStorageValues(rpcUrl, requested, resolvedBlock.blockHex)
      await writeStorageValues(chain, concreteBlockNumber, values, resolvedBlock.blockEnv)

      const addressCount = Object.keys(values).length
      const slotCount = Object.values(values).reduce((count, slotMap) => count + Object.keys(slotMap).length, 0)

      core.info(`Retrieved ${slotCount} slot values across ${addressCount} address(es) for chain ${chain}`)
    }

    core.setOutput('resolved-block-numbers-json', JSON.stringify(resolvedBlockNumbersByChain))
    core.info('Completed storage retrieval')
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
  }
}
