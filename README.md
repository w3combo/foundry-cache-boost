# Foundry Cache Boost

[![Continuous Integration](https://github.com/w3combo/foundry-cache-boost/actions/workflows/ci.yml/badge.svg)](https://github.com/w3combo/foundry-cache-boost/actions/workflows/ci.yml)

Foundry Cache Boost is a GitHub Action that targets faster forge test runs on forked networks (mainnet or any live
network) by storing used storage slots keys from previous runs and getting back all the slots values in batch before
next runs.

## Input

The action currently exposes these inputs.

- block: Block number or tag used to scope cache behavior.
  - Required: yes
  - Default: latest
  - Accepted formats:
    - Single identifier (applies to every configured chain), for example `latest` or `21547000`
    - JSON object mapping each chain to a block identifier, for example `{"mainnet":"finalized","polygon":69912345}`
- rpc-endpoints-json: JSON object mapping chain names to RPC URLs.
  - Required: yes
- cache-key-prefix: Prefix used for cache keys.
  - Required: no
  - Default: foundry-cache-boost

## Outputs

- resolved-block-numbers-json: JSON object mapping every configured chain to the resolved block number in decimal.

Slot hints are managed internally by the action in the Foundry cache directory and persisted through GitHub Actions
cache between runs.

When slot hints are available, the action fetches slot values ahead of test runs and merges them into Foundry's RPC
cache block files at:

- `$HOME/.foundry/cache/rpc/<chain>/<block>`

If a block path already exists and is not a valid JSON file, it is left untouched.

## Usage

This action is intended to run after Foundry installation.

Example workflow snippet:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1

      - name: Restore and inspect Foundry cache
        id: cache-boost
        uses: w3combo/foundry-cache-boost@v1
        with:
          block: '{"mainnet":"safe","polygon":"latest"}'
          rpc-endpoints-json: '{"mainnet":"http://localhost:4000/main/evm/1","polygon":"http://localhost:4000/main/evm/137"}'

      - name: Print resolved block numbers
        run: echo "${{ steps.cache-boost.outputs.resolved-block-numbers-json }}"

      - name: Run tests
        run: forge test
```

## Roadmap

- [x] Getting back slots keys after test runs and storing them in the cache
- [x] Getting back slots values in batch before test runs
- [x] Patch Foundry's RPC cache with "fake blocks" containing the extracted values
- [ ] Cache deployed bytecode and code hashes

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm run test
```

Bundle TypeScript into dist:

```bash
npm run bundle
```

Run full local checks:

```bash
npm run all
```
