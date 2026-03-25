import { jest } from '@jest/globals'
import { extractStorageValues } from '../src/storage-extractor.js'

const RPC_URL = 'https://eth.drpc.org'
const BLOCK = '0x1796f74'
const ADDRESS = '0xbb256c2f1b677e27118b0345fd2b3894d2e6d487'
const SLOTS = [
  '0x8',
  '0x2',
  '0x0',
  '0x1',
  '0x63187d71e139eee983a88d0737447c7451979b3dbb75903c76b5fe430d36588e',
  '0x54cdd369e4e8a8515e52ca72ec816c2101831ad1f18bf44102ed171459c9b4f8',
  '0x9',
  '0x4'
]

describe('storage-extractor.ts', () => {
  it('Skips malformed slots without making RPC calls', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => {
        throw new Error('fetch should not be called for malformed slot input')
      })

    const values = await extractStorageValues(
      RPC_URL,
      {
        [ADDRESS]: ['not-a-slot']
      },
      BLOCK
    )

    expect(values).toEqual({
      [ADDRESS]: {}
    })
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('Retrieves storage values from drpc using CI slot hints', async () => {
    jest.setTimeout(90_000)

    const values = await extractStorageValues(
      RPC_URL,
      {
        [ADDRESS]: SLOTS
      },
      BLOCK
    )

    expect(values[ADDRESS]).toBeDefined()

    const retrievedSlots = Object.keys(values[ADDRESS])
    expect(retrievedSlots.length).toBeGreaterThan(0)
    expect(values[ADDRESS]['0x8']).toBeDefined()
  })
})
