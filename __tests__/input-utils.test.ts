import { parseBlockConfig, resolveBlockForChain } from '../src/input-utils.js'

describe('input-utils.ts parseBlockConfig', () => {
  it('Parses a single block tag identifier as default block', () => {
    const config = parseBlockConfig('latest')

    expect(config).toEqual({
      defaultBlock: 'latest',
      blocksByChain: {}
    })
  })

  it('Parses and normalizes a single decimal block identifier as default block', () => {
    const config = parseBlockConfig('291')

    expect(config).toEqual({
      defaultBlock: '0x123',
      blocksByChain: {}
    })
  })

  it('Parses a per-chain JSON mapping', () => {
    const config = parseBlockConfig('{"mainnet":"finalized","base":291}')

    expect(config).toEqual({
      blocksByChain: {
        mainnet: 'finalized',
        base: '0x123'
      }
    })
  })

  it('Throws when block input is empty', () => {
    expect(() => parseBlockConfig('   ')).toThrow('block input cannot be empty')
  })

  it('Throws when per-chain mapping JSON is malformed', () => {
    expect(() => parseBlockConfig('{"mainnet":')).toThrow(
      'Invalid block input. Use a block identifier or a JSON object mapping chains to block identifiers'
    )
  })

  it('Throws when per-chain mapping JSON object is empty', () => {
    expect(() => parseBlockConfig('{}')).toThrow('Invalid block input. Per-chain block mapping cannot be empty')
  })

  it('Throws when per-chain block value has an unsupported type', () => {
    expect(() => parseBlockConfig('{"mainnet":true}')).toThrow('Invalid block input type: boolean')
  })

  it('Throws when per-chain block value is null', () => {
    expect(() => parseBlockConfig('{"mainnet":null}')).toThrow('Invalid block input type: object')
  })
})

describe('input-utils.ts resolveBlockForChain', () => {
  it('Returns chain-specific block when present', () => {
    const block = resolveBlockForChain(
      {
        defaultBlock: 'latest',
        blocksByChain: {
          mainnet: 'finalized'
        }
      },
      'mainnet'
    )

    expect(block).toBe('finalized')
  })

  it('Falls back to default block when chain mapping is missing', () => {
    const block = resolveBlockForChain(
      {
        defaultBlock: '0x123',
        blocksByChain: {}
      },
      'mainnet'
    )

    expect(block).toBe('0x123')
  })

  it('Throws when chain mapping is missing and no default block is configured', () => {
    expect(() =>
      resolveBlockForChain(
        {
          blocksByChain: {}
        },
        'mainnet'
      )
    ).toThrow('Missing block configuration for chain mainnet')
  })
})
