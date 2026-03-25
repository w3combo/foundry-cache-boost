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
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            number: '0x123'
          }
        })
    } as Response)
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
      '/home/tester/.foundry/cache/rpc/mainnet/0x123',
      expect.stringContaining('"storage"'),
      'utf-8'
    )
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
    expect(core.info).toHaveBeenCalledWith(
      'Skipping /home/tester/.foundry/cache/rpc/mainnet/0x123: path is a directory'
    )
  })

  it('Skips writing when existing file has malformed JSON', async () => {
    stat.mockResolvedValueOnce({
      isDirectory: () => false,
      isFile: () => true
    })
    readFile.mockResolvedValueOnce('{bad json')

    await run()

    expect(writeFile).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith('Skipping /home/tester/.foundry/cache/rpc/mainnet/0x123: malformed JSON')
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
      storage: Record<string, Record<string, string>>
      transactions: string[]
    }

    expect(parsed.transactions).toEqual(['0xabc'])
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
})
