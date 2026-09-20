# ROM editor host

This application reuses the pinned Pascal workspace packages. Its root page is inert until the ROM host session is connected. The `RomEditor` component requires explicit load/save callbacks; it does not opt into the standalone application's scene database or MCP service.

From the repository root, use Bun 1.3.14:

```sh
bun install --frozen-lockfile
bun run --cwd packages/core build
bun run --cwd packages/viewer build
bun run --cwd packages/nodes build
ROM_PARENT_ORIGIN=http://127.0.0.1:4182 bun run --cwd apps/rom-editor dev
```

`ROM_PARENT_ORIGIN` must be one exact origin. HTTP is accepted only for a loopback development origin. Production configuration requires HTTPS. This value controls `frame-ancestors`; it never carries platform authentication.

The assets preparation script copies the pinned local icons into an ignored generated public directory. No remote plugins or fonts are loaded by this app. Core/viewer/nodes must be built because their package entry points resolve to `dist`.

```sh
bun test apps/rom-editor/lib
ROM_PARENT_ORIGIN=https://rom.example bun run --cwd apps/rom-editor check-types
```

The platform's browser acceptance harness supplies a temporary route with a fixture and in-memory callbacks. That route is generated exclusively for the test and removed on graceful shutdown. It is not a persistence API or a production entry point. Browser save/reopen acceptance must pass before this host is connected to platform draft writes.

Run from the platform frontend with `PASCAL_EDITOR_WORKTREE` pointing to this isolated editor checkout:

```sh
PASCAL_EDITOR_WORKTREE=/absolute/path/to/editor npx --no-install playwright test --config test/browser/pascal.playwright.config.ts
```

The default uses headed Chromium with the native display. Set `PASCAL_HEADLESS=1` for headless execution; the tested host uses software WebGL in that mode and is substantially slower. The host disables post-processing through the public editor option. Acceptance verifies a real inspector position edit, exact graph preservation after remount, and absence of browser errors. This does not certify WebGPU or simulator execution.
