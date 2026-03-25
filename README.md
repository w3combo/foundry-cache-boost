# Foundry Cache Boost

[![Continuous Integration](https://github.com/w3combo/foundry-cache-boost/actions/workflows/ci.yml/badge.svg)](https://github.com/w3combo/foundry-cache-boost/actions/workflows/ci.yml)

Foundry Cache Boost is a GitHub Action that targets faster forge test runs on
forked networks (mainnet or any real network) by reusing Foundry cache data
across workflow runs.

Current milestone scope:

- Main step restores slot hints from GitHub Actions cache and fetches storage
  values.
- Post-job step scans `~/.foundry/cache/rpc/<chain>/` files and persists used
  slots.
- Bytecode caching is planned for a later iteration.

## Input

The action currently exposes these inputs.

- block: Block number or tag used to scope cache behavior.
  - Required: yes
  - Default: latest
- rpc-endpoints-json: JSON object mapping chain names to RPC URLs.
  - Required: yes
- cache-key-prefix: Prefix used for cache keys.
  - Required: no
  - Default: foundry-cache-boost

Slot hints are managed internally by the action in the Foundry cache directory
and persisted through GitHub Actions cache between runs.

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
        uses: w3combo/foundry-cache-boost@v1
        with:
          block: latest
          rpc-endpoints-json: '{"mainnet":"http://localhost:4000/main/evm/1","polygon":"http://localhost:4000/main/evm/137"}'

      - name: Run tests
        run: forge test
```

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
