# 🐍 CoilSnake for Visual Studio Code

[![Visual Studio Marketplace](https://img.shields.io/badge/Visual%20Studio%20Marketplace-Install-brightgreen)](https://marketplace.visualstudio.com/items?itemName=joelday.coilsnake-vscode)

<p align="center">
  <img alt="CoilSnake for Visual Studio Code icon" src="https://github.com/joelday/coilsnake-vscode/raw/main/packages/vscode-extension/images/icon.png">
</p>

CCScript language support for [CoilSnake](https://github.com/pk-hack/CoilSnake) projects: a full language server for the scripting language used to write EarthBound dialogue and events.

## Features

- Syntax and semantic highlighting
- Diagnostics as you type, matching what the CCScript compiler accepts
- Completions, ranked by the parameter being filled
- Hover, signature help, go to definition, find references and rename
- Document and workspace symbols, folding and document highlights
- Inlay hints: parameter names, what literal values refer to (items, characters, PSI, enemies, teleports and NPC dialogue from the CoilSnake project's tables), which table entries use a label, and the commands that raw control codes in strings encode
- Code actions, including converting raw control codes to the commands that produce them
- **CCScript Project** and **CCScript AST** views in the Explorer

## Setup

Open the folder containing your CoilSnake project. For standard library support (`std.ccs`, `stdarg.ccs`), point `ccscript.stdLibPath` at CoilSnake's `lib` directory, for example `coilsnake/assets/mobile-sprout/lib` inside a CoilSnake checkout.

## Preview builds

Every change on `main` is published to the Marketplace **pre-release** channel. Switch to it from the extension's page in VS Code to get new features as they land, and switch back to the release channel at any time. Found a problem? [Open an issue](https://github.com/joelday/coilsnake-vscode/issues).
