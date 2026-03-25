import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type AddressSlotsMapping = Record<string, string[]>

export interface ParsedStorageInput {
  global?: AddressSlotsMapping
  chains: Record<string, AddressSlotsMapping>
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const BLOCK_TAGS = new Set([
  'latest',
  'earliest',
  'pending',
  'safe',
  'finalized'
])

function isAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value)
}

function normalizeRpcUrl(value: string): string {
  const candidate = value.trim()
  if (candidate.length === 0) {
    throw new Error('RPC URL cannot be empty')
  }

  if (candidate.startsWith('ws://') || candidate.startsWith('wss://')) {
    throw new Error(
      `WebSocket RPC URLs are not supported for this action: ${candidate}`
    )
  }

  const withProtocol =
    candidate.startsWith('http://') || candidate.startsWith('https://')
      ? candidate
      : `http://${candidate}`

  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new Error(`Invalid RPC URL: ${candidate}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported RPC URL protocol: ${parsed.protocol}`)
  }

  return parsed.toString()
}

export function parseRpcEndpointsJson(input: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    throw new Error('Input rpc-endpoints-json must be a valid JSON object')
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Input rpc-endpoints-json must be a JSON object')
  }

  const normalized: Record<string, string> = {}
  for (const [chain, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new Error(`RPC endpoint for chain ${chain} must be a string URL`)
    }

    normalized[chain] = normalizeRpcUrl(value)
  }

  if (Object.keys(normalized).length === 0) {
    throw new Error('Input rpc-endpoints-json cannot be empty')
  }

  return normalized
}

export function normalizeSlot(slot: unknown): string {
  if (typeof slot === 'number') {
    if (!Number.isInteger(slot) || slot < 0) {
      throw new Error(`Invalid numeric slot value: ${slot}`)
    }
    return `0x${slot.toString(16)}`
  }

  if (typeof slot !== 'string') {
    throw new Error(`Slot must be string or integer, got ${typeof slot}`)
  }

  const raw = slot.trim().toLowerCase()
  if (raw.length === 0) {
    throw new Error('Slot cannot be empty')
  }

  if (raw.startsWith('0x')) {
    BigInt(raw)
    return raw
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`Slot must be decimal digits or 0x hex string: ${slot}`)
  }

  return `0x${BigInt(raw).toString(16)}`
}

export function normalizeAddress(address: unknown): string {
  if (typeof address !== 'string') {
    throw new Error('Address must be a string')
  }

  const normalized = address.trim().toLowerCase()
  if (!isAddress(normalized)) {
    throw new Error(`Invalid address: ${address}`)
  }

  return normalized
}

function normalizeAddressSlotsMapping(
  value: unknown,
  contextLabel: string
): AddressSlotsMapping {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${contextLabel} must be an object of address -> slot[]`)
  }

  const out: AddressSlotsMapping = {}
  for (const [rawAddress, rawSlots] of Object.entries(value)) {
    const address = normalizeAddress(rawAddress)
    if (!Array.isArray(rawSlots)) {
      throw new Error(`Slots for address ${address} must be an array`)
    }

    const slots: string[] = []
    for (const rawSlot of rawSlots) {
      try {
        slots.push(normalizeSlot(rawSlot))
      } catch {
        // Keep behavior resilient: malformed slots are skipped.
      }
    }

    out[address] = Array.from(new Set(slots))
  }

  return out
}

export async function readStorageInputFile(
  inputPath: string
): Promise<ParsedStorageInput> {
  const filePath = resolve(process.cwd(), inputPath)
  const data = await readFile(filePath, 'utf-8')

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    throw new Error(`Invalid JSON in storage-input-path file: ${filePath}`)
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Storage input JSON must be an object')
  }

  const obj = parsed as Record<string, unknown>

  if ('storage' in obj) {
    return {
      global: normalizeAddressSlotsMapping(obj.storage, 'storage'),
      chains: {}
    }
  }

  if ('chains' in obj) {
    const chains = obj.chains
    if (
      chains === null ||
      typeof chains !== 'object' ||
      Array.isArray(chains)
    ) {
      throw new Error('chains must be an object mapping chain -> address map')
    }

    const outChains: Record<string, AddressSlotsMapping> = {}
    for (const [chain, chainMapping] of Object.entries(chains)) {
      outChains[chain] = normalizeAddressSlotsMapping(
        chainMapping,
        `chains.${chain}`
      )
    }

    return { chains: outChains }
  }

  const keys = Object.keys(obj)
  if (keys.length === 0) {
    return { chains: {} }
  }

  const looksLikeAddressMap = keys.every((key) => isAddress(key))
  if (looksLikeAddressMap) {
    return {
      global: normalizeAddressSlotsMapping(obj, 'root storage mapping'),
      chains: {}
    }
  }

  const outChains: Record<string, AddressSlotsMapping> = {}
  for (const [chain, chainMapping] of Object.entries(obj)) {
    outChains[chain] = normalizeAddressSlotsMapping(
      chainMapping,
      `chain ${chain}`
    )
  }

  return { chains: outChains }
}

export function getChainStorageRequest(
  parsed: ParsedStorageInput,
  chain: string
): AddressSlotsMapping {
  return parsed.chains[chain] ?? parsed.global ?? {}
}

export function normalizeBlockIdentifier(rawBlock: string): string {
  const block = rawBlock.trim().toLowerCase()
  if (block.length === 0) {
    throw new Error('block input cannot be empty')
  }

  if (BLOCK_TAGS.has(block)) {
    return block
  }

  if (block.startsWith('0x')) {
    BigInt(block)
    return `0x${BigInt(block).toString(16)}`
  }

  if (/^\d+$/.test(block)) {
    return `0x${BigInt(block).toString(16)}`
  }

  throw new Error(
    'Invalid block input. Use latest/pending/safe/finalized/earliest, hex, or decimal'
  )
}

export function parseNumericBlock(blockIdentifier: string): bigint | undefined {
  if (BLOCK_TAGS.has(blockIdentifier)) {
    return undefined
  }

  if (blockIdentifier.startsWith('0x')) {
    return BigInt(blockIdentifier)
  }

  if (/^\d+$/.test(blockIdentifier)) {
    return BigInt(blockIdentifier)
  }

  return undefined
}

export function isBlockWithinWindow(
  fileBlock: bigint,
  targetBlock: bigint,
  windowSize: bigint
): boolean {
  const start = targetBlock > windowSize ? targetBlock - windowSize : 0n
  return fileBlock >= start && fileBlock <= targetBlock
}
