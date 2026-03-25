import * as core from '@actions/core'
import { normalizeSlot } from './input-utils.js'

const OVERRIDE_STORAGE_READER_CODE = '0x5f5b80361460135780355481526020016001565b365ff3'
const MAX_BATCH_SIZE = 1000
const MAX_RETRIES = 5
const MULTICALL3_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11'
const MULTICALL3_AGGREGATE3_SELECTOR = '82ad56cb'

export type SlotValuesByAddress = Record<string, Record<string, string>>

interface AggregateCall {
  target: string
  allowFailure: boolean
  callData: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stripHexPrefix(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value
}

function encodeUint256(value: bigint): string {
  const hex = value.toString(16)
  return hex.padStart(64, '0')
}

function encodeBool(value: boolean): string {
  return encodeUint256(value ? 1n : 0n)
}

function encodeAddress(address: string): string {
  return `${'0'.repeat(24)}${stripHexPrefix(address.toLowerCase())}`
}

function encodeBytes(dataHex: string): string {
  if (!dataHex.startsWith('0x')) {
    throw new Error('Bytes value must be 0x-prefixed hex')
  }

  const payload = stripHexPrefix(dataHex)
  if (payload.length % 2 !== 0) {
    throw new Error('Hex payload must have an even number of characters')
  }

  const byteLength = BigInt(payload.length / 2)
  const paddedBytes = Number(((byteLength + 31n) / 32n) * 32n)
  const paddedHex = payload.padEnd(paddedBytes * 2, '0')
  return `${encodeUint256(byteLength)}${paddedHex}`
}

function encodeAggregate3Call(calls: AggregateCall[]): string {
  const argHead = encodeUint256(32n)
  const n = calls.length

  const offsets: string[] = []
  const encodedElements: string[] = []
  let runningOffset = BigInt(n * 32)

  for (const call of calls) {
    const encodedCallData = encodeBytes(call.callData)
    const element = encodeAddress(call.target) + encodeBool(call.allowFailure) + encodeUint256(96n) + encodedCallData

    offsets.push(encodeUint256(runningOffset))
    encodedElements.push(element)
    runningOffset += BigInt(element.length / 2)
  }

  const arrayBody = `${encodeUint256(BigInt(n))}${offsets.join('')}${encodedElements.join('')}`
  return `0x${MULTICALL3_AGGREGATE3_SELECTOR}${argHead}${arrayBody}`
}

function readWord(data: Buffer, offset: number): bigint {
  if (offset < 0 || offset + 32 > data.length) {
    throw new Error('Out-of-bounds ABI read')
  }

  return BigInt(`0x${data.subarray(offset, offset + 32).toString('hex')}`)
}

function decodeAggregate3Result(resultHex: string): Array<{ success: boolean; data: Buffer }> {
  if (!resultHex.startsWith('0x')) {
    throw new Error('Invalid aggregate3 return')
  }

  const payloadHex = stripHexPrefix(resultHex)
  if (payloadHex.length % 2 !== 0) {
    throw new Error('Invalid aggregate3 return length')
  }

  const data = Buffer.from(payloadHex, 'hex')
  const arrStart = Number(readWord(data, 0))
  const n = Number(readWord(data, arrStart))
  const headStart = arrStart + 32

  const out: Array<{ success: boolean; data: Buffer }> = []
  for (let i = 0; i < n; i += 1) {
    const elemRel = Number(readWord(data, headStart + i * 32))
    const elemStart = headStart + elemRel

    const success = readWord(data, elemStart) !== 0n
    const bytesRel = Number(readWord(data, elemStart + 32))
    const bytesStart = elemStart + bytesRel
    const bytesLength = Number(readWord(data, bytesStart))
    const bytesDataStart = bytesStart + 32
    const bytesDataEnd = bytesDataStart + bytesLength

    if (bytesDataEnd > data.length) {
      throw new Error('Invalid bytes bounds in aggregate3 return')
    }

    out.push({
      success,
      data: data.subarray(bytesDataStart, bytesDataEnd)
    })
  }

  return out
}

async function jsonRpcCall(rpcUrl: string, method: string, params: unknown[], requestId: number): Promise<unknown> {
  const payload = {
    jsonrpc: '2.0',
    id: requestId,
    method,
    params
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
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

function normalizeHexValue(value: string): string {
  return `0x${BigInt(value).toString(16)}`
}

function slotToWord(slotHex: string): string {
  return stripHexPrefix(slotHex).padStart(64, '0')
}

interface BatchJob {
  address: string
  slots: string[]
}

function buildJobs(storageInput: Record<string, unknown[]>): BatchJob[] {
  const jobs: BatchJob[] = []

  for (const [address, slots] of Object.entries(storageInput)) {
    const normalizedSlots: string[] = []
    for (const slot of slots) {
      try {
        normalizedSlots.push(normalizeSlot(slot))
      } catch {
        // Keep extraction best-effort for malformed slots.
      }
    }

    for (let index = 0; index < normalizedSlots.length; index += MAX_BATCH_SIZE) {
      const batchSlots = normalizedSlots.slice(index, index + MAX_BATCH_SIZE)
      jobs.push({ address, slots: batchSlots })
    }
  }

  return jobs
}

export async function extractStorageValues(
  rpcUrl: string,
  storageInput: Record<string, unknown[]>,
  blockIdentifier: string
): Promise<SlotValuesByAddress> {
  const output: SlotValuesByAddress = {}
  for (const address of Object.keys(storageInput)) {
    output[address] = {}
  }

  const jobs = buildJobs(storageInput)
  const requestedAddressCount = Object.keys(storageInput).length
  const requestedSlotCount = jobs.reduce((count, job) => count + job.slots.length, 0)
  core.debug(
    `Storage extractor request prepared: ${requestedAddressCount} address(es), ${requestedSlotCount} slot(s), ${jobs.length} batch job(s), block ${blockIdentifier}`
  )
  let requestId = 1

  let cursor = 0
  while (cursor < jobs.length) {
    const batchJobs: BatchJob[] = []
    let slotCount = 0

    while (cursor < jobs.length) {
      const candidate = jobs[cursor]
      if (candidate.slots.length === 0) {
        cursor += 1
        continue
      }

      if (slotCount + candidate.slots.length > MAX_BATCH_SIZE) {
        break
      }

      batchJobs.push(candidate)
      slotCount += candidate.slots.length
      cursor += 1

      if (slotCount >= MAX_BATCH_SIZE) {
        break
      }
    }

    if (batchJobs.length === 0) {
      continue
    }

    const batchAddressCount = batchJobs.length
    const batchSlotCount = batchJobs.reduce((count, job) => count + job.slots.length, 0)
    core.debug(`Processing extraction batch: ${batchAddressCount} address(es), ${batchSlotCount} slot(s)`)

    const calls: AggregateCall[] = []
    const stateOverrides: Record<string, { code: string }> = {}

    for (const { address, slots } of batchJobs) {
      const callData = `0x${slots.map(slotToWord).join('')}`
      calls.push({
        target: address,
        allowFailure: true,
        callData
      })
      stateOverrides[address] = { code: OVERRIDE_STORAGE_READER_CODE }
    }

    let multicallCalldata: string
    try {
      multicallCalldata = encodeAggregate3Call(calls)
    } catch {
      continue
    }

    const payloadParams: unknown[] = [
      {
        to: MULTICALL3_ADDRESS,
        data: multicallCalldata
      },
      blockIdentifier,
      stateOverrides
    ]

    let rpcResult: unknown
    let rpcSuccess = false
    let rpcFailureReason: string | undefined

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      requestId += 1
      try {
        rpcResult = await jsonRpcCall(rpcUrl, 'eth_call', payloadParams, requestId)
        rpcSuccess = true
        break
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        rpcFailureReason = message
        core.debug(`eth_call attempt ${attempt + 1}/${MAX_RETRIES} failed: ${message}`)
        await sleep(150 * (attempt + 1))
      }
    }

    if (!rpcSuccess || typeof rpcResult !== 'string' || !rpcResult.startsWith('0x')) {
      core.debug(`Skipping batch after eth_call failure. Last reason: ${rpcFailureReason ?? 'missing/invalid result'}`)
      continue
    }

    let decoded: Array<{ success: boolean; data: Buffer }>
    try {
      decoded = decodeAggregate3Result(rpcResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      core.debug(`Failed to decode aggregate3 result: ${message}`)
      continue
    }

    const callCount = Math.min(decoded.length, batchJobs.length)
    let extractedInBatch = 0
    for (let index = 0; index < callCount; index += 1) {
      const { success, data } = decoded[index]
      if (!success) {
        core.debug(`aggregate3 call ${index} returned success=false`)
        continue
      }

      const { address, slots } = batchJobs[index]
      const expectedLength = slots.length * 32
      if (data.length < expectedLength) {
        core.debug(`aggregate3 call ${index} returned ${data.length} bytes, expected at least ${expectedLength}`)
        continue
      }

      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const start = slotIndex * 32
        const end = start + 32
        if (end > data.length) {
          break
        }

        const word = data.subarray(start, end)
        output[address][slots[slotIndex]] = normalizeHexValue(`0x${word.toString('hex')}`)
        extractedInBatch += 1
      }
    }

    core.debug(
      `Finished extraction batch: extracted ${extractedInBatch} slot value(s) across ${callCount} decoded call(s)`
    )
  }

  const totalExtracted = Object.values(output).reduce((count, slotMap) => count + Object.keys(slotMap).length, 0)
  core.debug(`Storage extractor completed: extracted ${totalExtracted}/${requestedSlotCount} requested slot(s)`)

  return output
}
