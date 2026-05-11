# Arguslog SDKs

Public mirror of the customer-facing packages from the [Arguslog](https://arguslog.org)
platform — Sentry-compatible error tracking with first-class Web3 support, hosted on
Railway, with billing-aware multi-tenancy.

The platform itself (ingest pipeline, API server, dashboard, billing engine) is closed
source. **This repo holds only the parts every customer reads, installs, or talks to**:
SDKs, the MCP server, and the CLI.

| Runtime | Package | Source |
| --- | --- | --- |
| Browser (JS/TS) | [`@arguslog/sdk-browser`](https://www.npmjs.com/package/@arguslog/sdk-browser) | [`packages/sdk-browser/`](packages/sdk-browser) |
| React | [`@arguslog/sdk-react`](https://www.npmjs.com/package/@arguslog/sdk-react) | [`packages/sdk-react/`](packages/sdk-react) |
| Vue 3 | [`@arguslog/sdk-vue`](https://www.npmjs.com/package/@arguslog/sdk-vue) | [`packages/sdk-vue/`](packages/sdk-vue) |
| Angular | [`@arguslog/sdk-angular`](https://www.npmjs.com/package/@arguslog/sdk-angular) | [`packages/sdk-angular/`](packages/sdk-angular) |
| Next.js | [`@arguslog/sdk-nextjs`](https://www.npmjs.com/package/@arguslog/sdk-nextjs) | [`packages/sdk-nextjs/`](packages/sdk-nextjs) |
| React Native | [`@arguslog/sdk-react-native`](https://www.npmjs.com/package/@arguslog/sdk-react-native) | [`packages/sdk-react-native/`](packages/sdk-react-native) |
| Node.js | [`@arguslog/sdk-node`](https://www.npmjs.com/package/@arguslog/sdk-node) | [`packages/sdk-node/`](packages/sdk-node) |
| Web3 add-on | [`@arguslog/sdk-web3`](https://www.npmjs.com/package/@arguslog/sdk-web3) | [`packages/sdk-web3/`](packages/sdk-web3) |
| Java / Spring | `org.arguslog:arguslog-java-sdk` (Maven) | [`java-sdk/`](java-sdk) |
| Python 3.9+ | [`arguslog`](https://pypi.org/project/arguslog/) (PyPI) | [`python-sdk/`](python-sdk) |
| MCP server | [`@arguslog/mcp-server`](https://www.npmjs.com/package/@arguslog/mcp-server) | [`packages/mcp-server/`](packages/mcp-server) |
| CLI | [`@arguslog/cli`](https://www.npmjs.com/package/@arguslog/cli) | [`cli/`](cli) |

## Quick start

Pick an SDK and follow its README — each package has a self-contained install +
first-event snippet. The consolidated quick-start lives in [`docs/sdks.md`](docs/sdks.md).

For the MCP server (hosted at `https://mcp.arguslog.org/mcp`) see
[`packages/mcp-server/README.md`](packages/mcp-server/README.md).

## About this repo

This is a **read-only public mirror** kept in sync with the upstream private monorepo
via a CI workflow that runs on every push to `main`. Releases (npm tag pushes,
PyPI / Maven publishes) happen here too — the release workflows shipped in
`.github/workflows/release-*.yml` are tag-driven and run on this public repo.

**Issues** and **pull requests** are welcome here for any of the SDKs / MCP / CLI.
Backend questions (ingest, billing, dashboard) should go to
<support@arguslog.org> instead — the source isn't open.

## License

[MIT](LICENSE).
