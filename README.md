# Foundry Cache Boost

![Coverage](./badges/coverage.svg)

Foundry Cache Boost is a GitHub Action that targets faster forge test runs on
forked networks (mainnet or any real network) by reusing Foundry cache data
across workflow runs.

Current milestone scope:

- Main step restores slot hints from GitHub Actions cache and fetches storage
  values.
- Post-job step scans ~/.foundry/cache/rpc/<chain>/ files and persists used
  slots.
- Bytecode caching is planned for a later iteration.

## Input

The action currently exposes one input.

- block: Block number or tag used to scope cache behavior.
  - Required: yes
  - Default: latest
- storage-input-path: Path to JSON file with address->slots mapping.
  - Required: no
  - Default: .github/storage-input.json
- rpc-endpoints-json: JSON object mapping chain names to RPC URLs.
  - Required: yes
- cache-key-prefix: Prefix used for cache keys.
  - Required: no
  - Default: foundry-cache-boost

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
          storage-input-path: .github/storage-input.json
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
