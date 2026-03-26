import { jest } from '@jest/globals'
import { join } from 'node:path'
import * as core from '../__fixtures__/core.js'

const saveCache = jest.fn<(paths: string[], key: string) => Promise<number>>()
jest.unstable_mockModule('@actions/cache', () => ({
  saveCache
}))

const readdir = jest.fn<(path: string, options?: { withFileTypes?: boolean }) => Promise<unknown[]>>()
const readFile = jest.fn<(path: string, encoding: string) => Promise<string>>()
const homedir = jest.fn<() => string>()

const getCacheWindow = jest.fn<() => bigint>()
const getSlotHintsPath = jest.fn<() => string>()
const writeSlotHintsFile = jest.fn<(payload: unknown) => Promise<void>>()

jest.unstable_mockModule('../src/cache-utils.js', () => ({
  CACHE_MATCHED_KEY_STATE: 'FOUNDRY_CACHE_BOOST_MATCHED_KEY',
  CACHE_PRIMARY_KEY_STATE: 'FOUNDRY_CACHE_BOOST_PRIMARY_KEY',
  getCacheWindow,
  getSlotHintsPath,
  writeSlotHintsFile
}))

const isBlockWithinWindow = jest.fn<(fileBlock: bigint, targetBlock: bigint, windowSize: bigint) => boolean>()
const parseBlockConfig = jest.fn<
  (raw: string) => {
    defaultBlock?: string
    blocksByChain: Record<string, string>
  }
>()
const parseNumericBlock = jest.fn<(block: string) => bigint | undefined>()
const resolveBlockForChain = jest.fn<
  (
    blockConfig: {
      defaultBlock?: string
      blocksByChain: Record<string, string>
    },
    chain: string
  ) => string
>()

jest.unstable_mockModule('../src/input-utils.js', () => ({
  isBlockWithinWindow,
  parseBlockConfig,
  parseNumericBlock,
  resolveBlockForChain
}))

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('node:fs/promises', () => ({ readdir, readFile }))
jest.unstable_mockModule('node:os', () => ({ homedir }))

const { runPost } = await import('../src/post.js')

function dir(name: string): {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
} {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false
  }
}

function file(name: string): {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
} {
  return {
    name,
    isDirectory: () => false,
    isFile: () => true
  }
}

describe('post.ts', () => {
  const homeDir = '/home/runner'
  const rpcRoot = join(homeDir, '.foundry', 'cache', 'rpc')
  const mainnetDir = join(rpcRoot, 'mainnet')

  beforeEach(() => {
    homedir.mockReturnValue(homeDir)
    core.getInput.mockReturnValue('190')
    core.getState.mockImplementation((name: string) => {
      if (name === 'FOUNDRY_CACHE_BOOST_PRIMARY_KEY') {
        return 'cache-primary'
      }
      if (name === 'FOUNDRY_CACHE_BOOST_MATCHED_KEY') {
        return 'cache-previous'
      }
      return ''
    })

    parseBlockConfig.mockReturnValue({ defaultBlock: '0xbe', blocksByChain: {} })
    resolveBlockForChain.mockReturnValue('0xbe')
    parseNumericBlock.mockReturnValue(190n)
    getCacheWindow.mockReturnValue(128n)
    getSlotHintsPath.mockReturnValue('/tmp/slot-hints.json')
    isBlockWithinWindow.mockReturnValue(true)
    writeSlotHintsFile.mockResolvedValue(undefined)
    saveCache.mockResolvedValue(1)

    readdir.mockImplementation(async (path: string) => {
      if (path === rpcRoot) {
        return [dir('mainnet')]
      }
      if (path === mainnetDir) {
        return [file('189.json'), dir('nested')]
      }
      return []
    })

    readFile.mockResolvedValue(
      JSON.stringify({
        storage: {
          '0x1234567890abcdef1234567890abcdef12345678': {
            '0x0': '0x1',
            '0x1': '0x2'
          }
        }
      })
    )
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Aggregates slots by chain and saves cache payload', async () => {
    await runPost()

    expect(core.getInput).toHaveBeenNthCalledWith(1, 'block', {
      required: true
    })
    expect(readdir).toHaveBeenNthCalledWith(1, rpcRoot, {
      withFileTypes: true
    })
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(writeSlotHintsFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chains: {
          mainnet: {
            '0x1234567890abcdef1234567890abcdef12345678': ['0x0', '0x1']
          }
        },
        meta: expect.objectContaining({
          block: '0xbe',
          window: 128
        })
      })
    )
    expect(saveCache).toHaveBeenNthCalledWith(1, ['/tmp/slot-hints.json'], 'cache-primary')
  })

  it('Logs and continues when rpc cache directory is missing', async () => {
    const error = new Error('not found') as NodeJS.ErrnoException
    error.code = 'ENOENT'
    readdir.mockRejectedValueOnce(error)

    await runPost()

    expect(core.info).toHaveBeenNthCalledWith(1, `Foundry RPC cache directory does not exist: ${rpcRoot}`)
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('Skips cache save when matched key equals primary key', async () => {
    core.getState.mockReturnValue('cache-primary')

    await runPost()

    expect(saveCache).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenNthCalledWith(1, 'Skipping save; cache key already matched: cache-primary')
  })

  it('Fails on unexpected errors', async () => {
    writeSlotHintsFile.mockRejectedValueOnce(new Error('cannot write'))

    await runPost()

    expect(core.setFailed).toHaveBeenNthCalledWith(1, 'cannot write')
  })

  it('Writes per-chain block metadata when configured with chain mapping', async () => {
    parseBlockConfig.mockReturnValueOnce({
      blocksByChain: {
        mainnet: '0xbe'
      }
    })
    resolveBlockForChain.mockReturnValueOnce('0xbe')

    await runPost()

    expect(writeSlotHintsFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        meta: expect.objectContaining({
          blocksByChain: {
            mainnet: '0xbe'
          },
          window: 128
        })
      })
    )
  })

  it('Skips unknown chain directories when no default block is configured', async () => {
    const sepoliaDir = join(rpcRoot, 'sepolia')

    parseBlockConfig.mockReturnValueOnce({
      blocksByChain: {
        mainnet: '0xbe'
      }
    })

    readdir.mockImplementation(async (path: string) => {
      if (path === rpcRoot) {
        return [dir('mainnet'), dir('sepolia')]
      }
      if (path === mainnetDir) {
        return [file('189.json')]
      }
      if (path === sepoliaDir) {
        return [file('189.json')]
      }
      return []
    })

    await runPost()

    expect(core.info).toHaveBeenCalledWith(
      'Skipping chain directory sepolia: no block mapping for this chain and no default block is configured'
    )
    expect(readdir).not.toHaveBeenCalledWith(sepoliaDir, {
      withFileTypes: true
    })
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
