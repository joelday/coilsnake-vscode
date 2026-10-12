# CCScript Language Services Monorepo

This monorepo contains the CCScript language server and related tooling for providing CCScript language support in any LSP-compatible editor.

## Packages

### [`ccscript-core`](./packages/ccscript-core)
Core CCScript language services including:
- Scanner (tokenizer)
- Parser (AST generation)
- Semantic analyzer (type checking, name binding)
- Symbol tables and scope management

This package has no dependencies on VS Code or any specific editor and can be used standalone or integrated into any toolchain.

### [`ccscript-language-server`](./packages/ccscript-language-server)
LSP (Language Server Protocol) compliant language server for CCScript. Provides:
- IntelliSense (code completion)
- Hover information
- Go to definition
- Find all references
- Real-time diagnostics

Can be used with any editor that supports LSP (VS Code, Vim, Emacs, Sublime Text, etc.).

### [`vscode-extension`](./packages/vscode-extension)
VS Code extension that connects to the CCScript language server. Provides:
- Syntax highlighting
- Language configuration
- LSP client integration

## Getting Started

### Installation

```bash
# Install all dependencies
npm install

# Build all packages
npm run build
```

### Development

```bash
# Watch mode for all packages
npm run watch

# Run tests
npm run test

# Lint code
npm run lint
```

### Using the Language Server

The language server can be used with any LSP-compatible editor:

#### VS Code
Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=joelday.coilsnake-vscode) or open the `packages/vscode-extension` folder in VS Code and press F5 to launch a development instance.

#### Other Editors
The language server binary is located at `packages/ccscript-language-server/out/server.js`. Configure your editor's LSP client to use this server for `.ccs` files.

Example for Neovim with lspconfig:
```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

configs.ccscript = {
  default_config = {
    cmd = {'node', '/path/to/ccscript-language-server/out/server.js', '--stdio'},
    filetypes = {'ccscript'},
    root_dir = lspconfig.util.root_pattern('.git'),
  },
}

lspconfig.ccscript.setup{}
```

## Project Structure

```
coilsnake-vscode/
├── packages/
│   ├── ccscript-core/          # Core language services
│   │   ├── src/
│   │   │   ├── scanner.ts
│   │   │   ├── parser.ts
│   │   │   ├── syntaxTree.ts
│   │   │   ├── redNode.ts
│   │   │   ├── syntax/
│   │   │   ├── semantic/
│   │   │   └── test/
│   │   ├── index.ts
│   │   └── package.json
│   ├── ccscript-language-server/  # LSP server
│   │   ├── src/
│   │   │   └── server.ts
│   │   └── package.json
│   └── vscode-extension/       # VS Code client
│       ├── src/
│       │   └── extension.ts
│       ├── syntaxes/
│       ├── images/
│       └── package.json
├── docs/                       # Documentation
├── package.json               # Workspace root
└── README.md
```

## Documentation

- [Core Language Services](./docs/SEMANTIC_ANALYSIS.md)
- [Testing Strategy](./docs/CONFORMANCE.md)
- [Project Documentation](./PROJECT.md)

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Credits

- **CCScript** - Created by the PK Hack community
- **CoilSnake** - [pk-hack team](https://github.com/pk-hack/CoilSnake)
- **Roslyn** - Microsoft, for the red/green tree architecture inspiration
