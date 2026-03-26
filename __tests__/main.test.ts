/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
const restoreCache =
  jest.fn<(paths: string[], primaryKey: string, restoreKeys?: string[]) => Promise<string | undefined>>()
jest.unstable_mockModule('@actions/cache', () => ({
  restoreCache
}))

const buildCacheKeys = jest.fn<(prefix: string) => { primaryKey: string; restoreKeys: string[] }>()
const ensureBoostCacheDir = jest.fn<() => Promise<void>>()
const getSlotHintsPath = jest.fn<() => string>()
const readSlotHintsFile = jest.fn<
  () => Promise<{
    chains: Record<string, Record<string, string[]>>
    meta: { generatedAt: string; block: string; window: number }
  } | null>
>()

jest.unstable_mockModule('../src/cache-utils.js', () => ({
  CACHE_MATCHED_KEY_STATE: 'FOUNDRY_CACHE_BOOST_MATCHED_KEY',
  CACHE_PRIMARY_KEY_STATE: 'FOUNDRY_CACHE_BOOST_PRIMARY_KEY',
  buildCacheKeys,
  ensureBoostCacheDir,
  getSlotHintsPath,
  readSlotHintsFile
}))

const parseBlockConfig = jest.fn<
  (block: string) => {
    defaultBlock?: string
    blocksByChain: Record<string, string>
  }
>()
const resolveBlockForChain = jest.fn<
  (
    blockConfig: {
      defaultBlock?: string
      blocksByChain: Record<string, string>
    },
    chain: string
  ) => string
>()
const parseRpcEndpointsJson = jest.fn<(value: string) => Record<string, string>>()

jest.unstable_mockModule('../src/input-utils.js', () => ({
  parseBlockConfig,
  parseRpcEndpointsJson,
  resolveBlockForChain
}))

const extractStorageValues =
  jest.fn<
    (
      rpcUrl: string,
      storageInput: Record<string, unknown[]>,
      blockIdentifier: string
    ) => Promise<Record<string, Record<string, string>>>
  >()
jest.unstable_mockModule('../src/storage-extractor.js', () => ({
  extractStorageValues
}))

const mkdir = jest.fn<(path: string, options?: { recursive?: boolean }) => Promise<void>>()
const stat = jest.fn<(path: string) => Promise<{ isDirectory: () => boolean; isFile: () => boolean }>>()
const readFile = jest.fn<(path: string, encoding: string) => Promise<string>>()
const writeFile = jest.fn<(path: string, data: string, encoding: string) => Promise<void>>()

jest.unstable_mockModule('node:fs/promises', () => ({
  mkdir,
  readFile,
  stat,
  writeFile
}))

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  const fetchMock = jest.fn<typeof fetch>()

  beforeEach(() => {
    process.env.HOME = '/home/tester'
    global.fetch = fetchMock

    core.getInput.mockImplementation((name: string) => {
      if (name === 'block') return 'latest'
      if (name === 'rpc-endpoints-json') return '{"mainnet":"https://rpc"}'
      if (name === 'cache-key-prefix') return 'boost'
      return ''
    })

    buildCacheKeys.mockReturnValue({
      primaryKey: 'boost-linux-repo-ref-1',
      restoreKeys: ['boost-linux-repo-ref-', 'boost-linux-repo-']
    })
    getSlotHintsPath.mockReturnValue('/tmp/slot-hints.json')
    restoreCache.mockResolvedValue('boost-linux-repo-ref-0')
    parseBlockConfig.mockReturnValue({ defaultBlock: 'latest', blocksByChain: {} })
    resolveBlockForChain.mockReturnValue('latest')
    parseRpcEndpointsJson.mockReturnValue({
      mainnet: 'https://rpc'
    })
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        method?: string
      }

      if (parsed.method === 'eth_getBlockByNumber') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                number: '0x123',
                miner: '0xDdAbD0D80178819f2319190D340ce9A924F78371',
                timestamp: '0x69a74ec3',
                gasLimit: '0x5b8d80',
                baseFeePerGas: '0x8933f00',
                difficulty: '0x087353b2df9daa3c11ed7558e88cc9886f6bf7d0de9430c65f6308fd86576ce0',
                prevRandao: '0x087353b2df9daa3c11ed7558e88cc9886f6bf7d0de9430c65f6308fd86576ce0',
                excessBlobGas: '0x0'
              }
            })
        } as Response
      }

      if (parsed.method === 'eth_blobBaseFee') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: '0x1'
            })
        } as Response
      }

      return {
        ok: false,
        status: 400,
        text: async () => 'unsupported method'
      } as Response
    })
    readSlotHintsFile.mockResolvedValue({
      chains: {
        mainnet: {
          '0x1234567890abcdef1234567890abcdef12345678': ['0x1']
        }
      },
      meta: {
        generatedAt: '2026-03-25T00:00:00.000Z',
        block: 'latest',
        window: 128
      }
    })
    extractStorageValues.mockResolvedValue({
      '0x1234567890abcdef1234567890abcdef12345678': {
        '0x0': '0x1',
        '0x1': '0x2'
      }
    })

    stat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Restores cache and runs extraction for configured chains', async () => {
    await run()

    expect(core.getInput).toHaveBeenNthCalledWith(1, 'block', {
      required: true
    })
    expect(core.getInput).toHaveBeenNthCalledWith(2, 'rpc-endpoints-json', {
      required: true
    })
    expect(core.getInput).toHaveBeenNthCalledWith(3, 'cache-key-prefix')

    expect(ensureBoostCacheDir).toHaveBeenCalledTimes(1)
    expect(restoreCache).toHaveBeenNthCalledWith(1, ['/tmp/slot-hints.json'], 'boost-linux-repo-ref-1', [
      'boost-linux-repo-ref-',
      'boost-linux-repo-'
    ])
    expect(core.saveState).toHaveBeenNthCalledWith(1, 'FOUNDRY_CACHE_BOOST_PRIMARY_KEY', 'boost-linux-repo-ref-1')
    expect(core.saveState).toHaveBeenNthCalledWith(2, 'FOUNDRY_CACHE_BOOST_MATCHED_KEY', 'boost-linux-repo-ref-0')
    expect(core.setOutput).toHaveBeenNthCalledWith(1, 'resolved-block-numbers-json', '{"mainnet":"291"}')

    expect(extractStorageValues).toHaveBeenNthCalledWith(
      1,
      'https://rpc',
      {
        '0x1234567890abcdef1234567890abcdef12345678': ['0x1']
      },
      '0x123'
    )

    expect(mkdir).toHaveBeenNthCalledWith(1, '/home/tester/.foundry/cache/rpc/mainnet', { recursive: true })
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenNthCalledWith(
      1,
      '/home/tester/.foundry/cache/rpc/mainnet/291',
      expect.stringContaining('"storage"'),
      'utf-8'
    )

    const parsed = JSON.parse(writeFile.mock.calls[0][1]) as {
      meta: {
        block_env: {
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
        hosts: string[]
      }
      accounts: Record<string, unknown>
      block_hashes: Record<string, unknown>
    }

    expect(parsed.accounts).toEqual({})
    expect(parsed.block_hashes).toEqual({})
    expect(parsed.meta.hosts).toEqual(['localhost'])
    expect(parsed.meta.block_env.number).toBe('0x123')
    expect(parsed.meta.block_env.beneficiary).toBe('0xddabd0d80178819f2319190d340ce9a924f78371')
    expect(parsed.meta.block_env.timestamp).toBe('0x69a74ec3')
    expect(parsed.meta.block_env.gas_limit).toBe(6000000)
    expect(parsed.meta.block_env.basefee).toBe(143867648)
    expect(parsed.meta.block_env.difficulty).toBe('0x87353b2df9daa3c11ed7558e88cc9886f6bf7d0de9430c65f6308fd86576ce0')
    expect(parsed.meta.block_env.prevrandao).toBe('0x87353b2df9daa3c11ed7558e88cc9886f6bf7d0de9430c65f6308fd86576ce0')
    expect(parsed.meta.block_env.blob_excess_gas_and_price).toEqual({
      excess_blob_gas: 0,
      blob_gasprice: 1
    })

    expect(typeof parsed.meta).toBe('object')
    expect(typeof parsed.meta.block_env).toBe('object')
    expect(typeof parsed.meta.block_env.number).toBe('string')
    expect(typeof parsed.meta.block_env.beneficiary).toBe('string')
    expect(typeof parsed.meta.block_env.timestamp).toBe('string')
    expect(typeof parsed.meta.block_env.gas_limit).toBe('number')
    expect(typeof parsed.meta.block_env.basefee).toBe('number')
    expect(typeof parsed.meta.block_env.difficulty).toBe('string')
    expect(typeof parsed.meta.block_env.prevrandao).toBe('string')
  })

  it('Sets a failed status', async () => {
    parseBlockConfig.mockImplementationOnce(() => {
      throw new Error('bad block')
    })

    await run()

    expect(core.setFailed).toHaveBeenNthCalledWith(1, 'bad block')
  })

  it('Skips extraction when slot hints are not available for a chain', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'block') return 'latest'
      if (name === 'rpc-endpoints-json') return '{"mainnet":"https://rpc"}'
      if (name === 'cache-key-prefix') return 'boost'
      return ''
    })
    readSlotHintsFile.mockResolvedValueOnce({
      chains: {},
      meta: {
        generatedAt: '2026-03-25T00:00:00.000Z',
        block: 'latest',
        window: 128
      }
    })

    await run()

    expect(extractStorageValues).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith('Skipping chain mainnet: no slots requested')
    expect(core.setOutput).toHaveBeenNthCalledWith(1, 'resolved-block-numbers-json', '{"mainnet":"291"}')
  })

  it('Uses per-chain block configuration when resolving concrete blocks', async () => {
    parseBlockConfig.mockReturnValueOnce({
      blocksByChain: {
        mainnet: 'finalized'
      }
    })
    resolveBlockForChain.mockReturnValueOnce('finalized')

    await run()

    expect(resolveBlockForChain).toHaveBeenNthCalledWith(
      1,
      {
        blocksByChain: {
          mainnet: 'finalized'
        }
      },
      'mainnet'
    )
    expect(core.setOutput).toHaveBeenNthCalledWith(1, 'resolved-block-numbers-json', '{"mainnet":"291"}')
  })

  it('Skips writing when target block path is a directory', async () => {
    stat.mockResolvedValueOnce({
      isDirectory: () => true,
      isFile: () => false
    })

    await run()

    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith('Skipping /home/tester/.foundry/cache/rpc/mainnet/291: path is a directory')
  })

  it('Skips writing when existing file has malformed JSON', async () => {
    stat.mockResolvedValueOnce({
      isDirectory: () => false,
      isFile: () => true
    })
    readFile.mockResolvedValueOnce('{bad json')

    await run()

    expect(writeFile).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith('Skipping /home/tester/.foundry/cache/rpc/mainnet/291: malformed JSON')
  })

  it('Merges fetched storage with an existing valid block cache file', async () => {
    stat.mockResolvedValueOnce({
      isDirectory: () => false,
      isFile: () => true
    })
    readFile.mockResolvedValueOnce(
      JSON.stringify({
        storage: {
          '0x1234567890abcdef1234567890abcdef12345678': {
            '0x0': '0xold',
            '0x1': '0xexisting'
          },
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': {
            '0x2': '0xkeep'
          }
        },
        transactions: ['0xabc']
      })
    )

    await run()

    expect(writeFile).toHaveBeenCalledTimes(1)
    const writtenContent = writeFile.mock.calls[0][1]
    const parsed = JSON.parse(writtenContent) as {
      meta: {
        block_env: {
          number: string
        }
        hosts: string[]
      }
      accounts: Record<string, unknown>
      block_hashes: Record<string, unknown>
      storage: Record<string, Record<string, string>>
      transactions: string[]
    }

    expect(parsed.transactions).toEqual(['0xabc'])
    expect(parsed.accounts).toEqual({})
    expect(parsed.block_hashes).toEqual({})
    expect(parsed.meta.hosts).toEqual(['localhost'])
    expect(parsed.meta.block_env.number).toBe('0x123')
    expect(parsed.storage).toEqual({
      '0x1234567890abcdef1234567890abcdef12345678': {
        '0x0': '0x1',
        '0x1': '0x2'
      },
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': {
        '0x2': '0xkeep'
      }
    })
  })

  it('Falls back for missing optional block fields and uses mixHash as prevrandao', async () => {
    fetchMock.mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        method?: string
      }

      if (parsed.method === 'eth_getBlockByNumber') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                number: '0x123',
                miner: '0xDdAbD0D80178819f2319190D340ce9A924F78371',
                timestamp: '0x69a74ec3',
                gasLimit: '0x5b8d80',
                baseFeePerGas: null,
                difficulty: '0x01',
                mixHash: '0xabc',
                excessBlobGas: null
              }
            })
        } as Response
      }

      if (parsed.method === 'eth_blobBaseFee') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              error: {
                code: -32601,
                message: 'method not found'
              }
            })
        } as Response
      }

      return {
        ok: false,
        status: 400,
        text: async () => 'unsupported method'
      } as Response
    })

    await run()

    const parsed = JSON.parse(writeFile.mock.calls[0][1]) as {
      meta: {
        block_env: {
          basefee: number
          prevrandao: string
          blob_excess_gas_and_price: {
            excess_blob_gas: number
            blob_gasprice: number
          }
        }
      }
    }

    expect(parsed.meta.block_env.basefee).toBe(0)
    expect(parsed.meta.block_env.prevrandao).toBe('0xabc')
    expect(parsed.meta.block_env.blob_excess_gas_and_price).toEqual({
      excess_blob_gas: 0,
      blob_gasprice: 1
    })
  })
})
