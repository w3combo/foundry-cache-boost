import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CACHE_PRIMARY_KEY_STATE = 'FOUNDRY_CACHE_BOOST_PRIMARY_KEY'
export const CACHE_MATCHED_KEY_STATE = 'FOUNDRY_CACHE_BOOST_MATCHED_KEY'

const CACHE_WINDOW = 128n

export interface AggregatedSlotsPayload {
  chains: Record<string, Record<string, string[]>>
  meta: {
    generatedAt: string
    block: string
    window: number
  }
}

export function getCacheWindow(): bigint {
  return CACHE_WINDOW
}

export function getBoostCacheDir(): string {
  return join(homedir(), '.foundry', 'cache', 'foundry-cache-boost')
}

export function getSlotHintsPath(): string {
  return join(getBoostCacheDir(), 'slot-hints.json')
}

export async function ensureBoostCacheDir(): Promise<void> {
  await mkdir(getBoostCacheDir(), { recursive: true })
}

export async function readSlotHintsFile(): Promise<AggregatedSlotsPayload | null> {
  const path = getSlotHintsPath()
  try {
    const content = await readFile(path, 'utf-8')
    const parsed = JSON.parse(content) as AggregatedSlotsPayload
    if (!parsed || typeof parsed !== 'object' || typeof parsed.chains !== 'object') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function writeSlotHintsFile(payload: AggregatedSlotsPayload): Promise<void> {
  await ensureBoostCacheDir()
  const rendered = `${JSON.stringify(payload, null, 2)}\n`
  await writeFile(getSlotHintsPath(), rendered, 'utf-8')
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-')
}

export function buildCacheKeys(prefix: string): {
  primaryKey: string
  restoreKeys: string[]
} {
  const runner = sanitize(process.env.RUNNER_OS ?? process.platform)
  const repo = sanitize(process.env.GITHUB_REPOSITORY ?? 'local')
  const ref = sanitize(process.env.GITHUB_REF_NAME ?? 'unknown-ref')
  const sha = sanitize(process.env.GITHUB_SHA ?? 'unknown-sha')
  const runNumber = sanitize(process.env.GITHUB_RUN_NUMBER ?? `${Date.now()}`)
  const base = `${sanitize(prefix)}-${runner}-${repo}-${ref}`
  const shaBase = `${base}-${sha}`

  return {
    primaryKey: `${shaBase}-${runNumber}`,
    restoreKeys: [`${shaBase}-`, `${base}-`, `${sanitize(prefix)}-${runner}-${repo}-`]
  }
}
