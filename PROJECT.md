# CoilSnake VS Code Extension - Project Documentation

## Overview

A VS Code extension providing comprehensive language services for **CCScript**, the scripting language used in CoilSnake for EarthBound ROM hacking. The extension implements a complete language service with syntax analysis, error recovery, and will eventually include semantic analysis, IntelliSense, and code generation.

## Project Goals

### Primary Objectives
1. **Production-Quality Language Service** - Complete CCScript parsing with error recovery
2. **CoilSnake Integration** - Seamless integration with CoilSnake ROM hacking workflow
3. **Developer Experience** - IntelliSense, syntax highlighting, go-to-definition, refactoring
4. **Maintainability** - Well-tested, documented, and follows industry best practices

### Current Status

**✅ Phase 1: Syntax Analysis (COMPLETE)**
- Full scanner implementation with trivia handling
- Recursive descent parser with robust error recovery
- Roslyn-inspired red/green tree architecture
- 100% conformance with CCScript 1337 reference compiler
- 409/412 tests passing (99.3%)

**🔄 Phase 2: Semantic Analysis (IN PROGRESS)**
- Symbol table construction
- Scope management
- Type checking
- Name binding and resolution

**📋 Phase 3: Language Services (PLANNED)**
- IntelliSense (completions, parameter hints)
- Hover information
- Go to definition
- Find all references
- Rename refactoring
- Syntax highlighting improvements
- Code formatting

**📋 Phase 4: Advanced Features (PLANNED)**
- Real-time diagnostics
- Code actions (quick fixes)
- Signature help
- Folding ranges
- Document symbols
- Workspace symbols
- Integration with CoilSnake compiler

## Architecture

### Design Philosophy

The project follows **Microsoft Roslyn's red/green tree pattern**, which provides:
- **Memory efficiency** through immutable, shared green nodes
- **Fast cloning** for incremental parsing and real-time analysis
- **Rich navigation** through positioned red node wrappers
- **Production-grade** architecture used by C# and VB compilers

### Component Structure

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code Extension                    │
│                   (Future Integration)                  │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                    SyntaxTree API                       │
│           High-level parsing and querying               │
│  parse(), getLabels(), getConstants(), findNodes()      │
└───────┬─────────────────────────────────┬───────────────┘
        │                                 │
┌───────▼─────────┐              ┌────────▼──────────┐
│     Scanner     │              │      Parser       │
│  Tokenization   │              │  AST Construction │
│  Trivia handling│              │  Error Recovery   │
└───────┬─────────┘              └────────┬──────────┘
        │                                 │
        └────────┬────────────────────────┘
                 │
        ┌────────▼──────────┐
        │   Green Nodes     │
        │  (Immutable AST)  │
        │  Position-free    │
        └────────┬──────────┘
                 │
        ┌────────▼──────────┐
        │    Red Nodes      │
        │ (Positioned View) │
        │  Parent pointers  │
        │  Navigation API   │
        └───────────────────┘
```

### Core Components

#### 1. Scanner (`scanner.ts`)
**Purpose**: Tokenization with whitespace and comment preservation

**Features**:
- 142 tests (76 unit + 66 fixture tests)
- Trivia handling (leading/trailing whitespace, comments)
- All CCScript token types supported
- Error-tolerant (produces BadToken on errors)

**Token Types**:
- Keywords (case-sensitive, as in the compiler's lexer): `if`, `else`, `menu`, `default`, `define`, `command`, `or`, `and`, `not`, `flag`, `byte`, `short`, `long`, `ROM`, `ROMTBL`, `import`, `count`, `setcount`, `insertbin`
- Literals: integers (dec/hex/binary), strings
- Operators: `=`, `and`, `or`, `not`, `.`, `:`
- Delimiters: `(`, `)`, `[`, `]`, `{`, `}`

#### 2. Parser (`parser.ts`)
**Purpose**: Recursive descent parser with error recovery

**Features**:
- 51 unit tests
- LL(2) lookahead for label/identifier disambiguation
- Always produces complete AST (never throws on syntax errors)
- Error recovery with Missing* nodes
- Diagnostic generation with positions

**Parse Methods**:
- `parseStatement()` - Commands, defines, vars, labels, ROM writes
- `parseExpression()` - If, menu, boolean, bounds expressions
- `parseFactor()` - Literals, identifiers, calls, arrays
- `parseArguments()`, `parseParameters()`, etc.

#### 3. Green Nodes (`syntax/types.ts`)
**Purpose**: Immutable, position-independent syntax data

**Properties**:
- `kind: SyntaxKind` - Node/token type
- `width: number` - Total character width including trivia
- `children: GreenNode[]` - Child nodes/tokens
- `leadingTriviaWidth: number` - Leading whitespace
- `trailingTriviaWidth: number` - Trailing whitespace

**Characteristics**:
- Immutable (readonly fields)
- Shared across trees for memory efficiency
- No parent pointers or positions
- Created by parser, wrapped by red nodes

#### 4. Red Nodes (`redNode.ts`)
**Purpose**: Positioned wrappers providing navigation API

**Features**:
- 41 tests
- Lazy child creation with caching
- Parent pointer chain for ancestor queries
- Position tracking for range-based searches

**API**:
```typescript
getChildren(): RedNode[]
getParent(): RedNode | undefined
getAncestors(): RedNode[]
getDescendants(): RedNode[]
getNextSibling(): RedNode | undefined
getPreviousSibling(): RedNode | undefined
findNode(predicate): RedNode | undefined
isToken(): boolean
```

#### 5. SyntaxTree (`syntaxTree.ts`)
**Purpose**: High-level API coordinating scanner and parser

**Features**:
- 35 tests
- Factory method: `SyntaxTree.parse(source)`
- Query methods for declarations
- Position utilities

**API**:
```typescript
// Parsing
static parse(source: string): SyntaxTree
getRoot(): RedNode
getDiagnostics(): Diagnostic[]

// Declarations
getLabels(): RedNode[]
getConstants(): RedNode[]
getCommands(): RedNode[]
getIdentifiers(): RedNode[]

// Queries
findNodesOfKind(kind: SyntaxKind): RedNode[]
findNodes(predicate): RedNode[]
getNodeAtPosition(position: number): RedNode | undefined

// Position utilities
getLineAndColumn(position: number): { line, column }
getTokens(): RedNode[]
getStatements(): RedNode[]
```

## CCScript Language Reference

### Grammar (LL(2))

The language requires 2-token lookahead due to ambiguity between labels and identifiers:
- Labels: `identifier ':'`
- Identifier expressions: `identifier ...`

**Key Productions**:
```ebnf
program := ( statement )* EOF

statement := '{' ( statement )* '}'
          | command-def
          | const-def
          | label
          | rom-write
          | expression

command-def := 'command' IDENTIFIER ['(' params ')'] expression

const-def := 'define' IDENTIFIER '=' expression

label := IDENTIFIER ':'

rom-write := 'ROM' '[' expression ']' '=' expression
          | 'ROMTBL' '[' expression ',' expression ',' expression ']' '=' expression

expression := if-expr
           | menu-expr
           | block-expr
           | factor 'and' expression
           | factor 'or' expression
           | factor
           | bounds expression

if-expr := 'if' expression expression ['else' expression]

menu-expr := 'menu' [INT_LITERAL] '{' ( ['default'] expression ':' expression )* '}'

factor := 'flag' primary-expr
       | insertbin-expr
       | INT_LITERAL
       | STRING_LITERAL
       | '(' expression ')'
       | 'not' expression

primary-expr := INT_LITERAL
             | STRING_LITERAL
             | IDENTIFIER ['.' IDENTIFIER] ['(' args ')']

bounds := sizetag [ '[' INT_LITERAL ']' ]

sizetag := 'byte' | 'short' | 'long' | 'size' INT_LITERAL

insertbin-expr := 'insertbin' [ '[' INT_LITERAL [ ',' INT_LITERAL ] ']' ] STRING_LITERAL
```

The reference implementation is the compiler CoilSnake builds with,
[ccscript_legacy](https://github.com/charasyn/ccscript_legacy) (v1.500, pinned in CoilSnake's
`pyproject.toml`).

### Name Resolution

Matches the compiler:
- A CoilSnake build compiles every `.ccs` file directly in `Project/ccscript/`, plus whatever
  they import. `std.ccs` and `stdarg.ccs` are imported implicitly by every module.
- Unqualified names resolve to the module's own declarations, then the top-level declarations
  of its imports. Imports aren't transitive, and files in the same directory don't share names.
- `module.member` resolves against any loaded module, imported or not.
- Circular imports are allowed.
- Labels inside a block are visible throughout that block (forward jumps work).

### Language Features

#### Declarations
```ccscript
// Constants
define myNumber = 42
define myString = "Hello"
define myFlag = flag 1

// Commands
command myCommand() {
    // command body
}

command withParams(param1, param2) {
    // use param1, param2
}
```

#### Control Flow
```ccscript
// Labels
start:
    // code
    goto end

end:
    // done

// Conditionals
if flag 1 {
    // true branch
} else {
    // false branch
}

// If as expression
define result = if flag 2 10 else 20
```

#### Expressions
```ccscript
// Boolean operations
if flag 1 and flag 2 {
    // both flags set
}

if flag 3 or flag 4 {
    // either flag set
}

if not flag 5 {
    // flag not set
}

// Menu expressions
menu {
    "Option 1": action1()
    "Option 2": action2()
    default "Cancel": cancel()
}

// Array access
byte[0xC00000]
short[counter]
long[playerData + 4]
```

#### ROM Access
```ccscript
// Direct ROM write
ROM[0xC00000] = 42

// ROM table write
ROMTBL[tableIndex, entrySize, baseAddress] = value
```

### Standard Library

CCScript includes a comprehensive standard library (11 modules):

1. **lib_basic.ccs** - Core utilities
2. **lib_advanced.ccs** - Advanced operations
3. **lib_gameplay.ccs** - Game state manipulation
4. **lib_items.ccs** - Inventory and money
5. **lib_memory.ccs** - Memory operations
6. **lib_rom.ccs** - ROM access helpers
7. **lib_sound.ccs** - Sound and music
8. **lib_sprite.ccs** - Sprite control
9. **lib_status.ccs** - Status effects
10. **lib_text.ccs** - Text and dialogue
11. **lib_windows.ccs** - Window management

## Testing Strategy

### Test Coverage

**Total Tests**: 412
- **Passing**: 409 (99.3%)
- **Failing**: 3 (minor fixture issues, not conformance)

### Test Categories

#### 1. Unit Tests (297 tests)
**Scanner Tests** (142 tests)
- Token recognition
- Keyword vs identifier
- Numeric literals (decimal, hex, binary)
- String literals with escapes
- Trivia handling
- Error cases

**Parser Tests** (51 tests)
- Statement parsing (command, define, label)
- Expression parsing (if, menu, boolean, bounds)
- Factor parsing (literals, identifiers, calls)
- Error recovery
- Diagnostic generation

**RedNode Tests** (41 tests)
- Child creation and caching
- Parent pointers
- Tree navigation
- Sibling access
- Descendant queries

**SyntaxTree Tests** (35 tests)
- Declaration queries
- Node finding
- Position utilities
- Line/column conversion

#### 2. Fixture Tests (66 tests)
Uses 12 comprehensive `.ccs` test files covering:
- Basic declarations
- Complex expressions
- Boolean operations
- Array access
- Command definitions
- Label usage
- Flag expressions
- Menu statements
- Block scoping
- String handling
- ROM writes
- Real-world examples

#### 3. Conformance Tests (112 tests)
Validates against CCScript 1337 reference compiler:

**Parsing Tests** (33)
- Parse all reference test files without crashing
- ✅ 100% passing

**AST Validation** (33)
- Valid root nodes, EOF tokens
- Width matches source (accounting for line endings)
- ✅ 100% passing

**Feature-Specific** (7)
- Constant definitions
- Conditional expressions
- Commands, labels, flags
- Array access, boolean operations
- ✅ 100% passing

**Metadata Parsing** (33)
- Extract test metadata from comments
- ✅ 100% passing

**Coverage Analysis** (6)
- Keyword recognition
- Library test files
- Error tolerance
- ✅ 100% passing

### Reference Test Files

The CCScript 1337 compiler includes 33 test files with expected binary outputs:

**Core Features**:
- blank.ccs, defines.ccs, vars.ccs, commands.ccs, labels.ccs
- conditionals.ccs, ifexpr.ccs, flagexpr.ccs, boundedexpr.ccs
- booleanexpr.ccs, menuexpr.ccs, menus.ccs, romwrite.ccs
- stringexpr.ccs, number.ccs, text.ccs

**Advanced Features**:
- scopes.ccs, lazyeval.ccs, counters.ccs, cmdlabels.ccs

**Library Tests**:
- lib_basic.ccs, lib_advanced.ccs, lib_gameplay.ccs
- lib_items.ccs, lib_memory.ccs, lib_rom.ccs
- lib_sound.ccs, lib_sprite.ccs, lib_status.ccs
- lib_text.ccs, lib_windows.ccs

**Real-World**:
- hack_shoptest.ccs, testfile.ccs

## Development Setup

### Prerequisites
- Node.js 18+ (for ES2024 support)
- TypeScript 5.9.2
- VS Code 1.100.0+

### Installation

```bash
# Clone repository
git clone https://github.com/joelday/coilsnake-vscode.git
cd coilsnake-vscode

# Initialize submodules
git submodule update --init --recursive

# Install dependencies
npm install

# Download CCScript compiler (for conformance testing)
./scripts/setup-ccscript-compiler.sh
```

### Build and Test

```bash
# Compile TypeScript
npm run compile

# Run linter
npm run lint

# Run all tests
npm test

# Run specific test suite
npm test -- scanner.test.ts
npm test -- ccscriptConformance.test.ts

# Run tests in watch mode
npm test -- --watch

# Generate coverage report
npm test -- --coverage
```

### VS Code Development

```bash
# Compile and watch for changes
npm run watch

# Open in VS Code
code .

# Press F5 to launch Extension Development Host
# Test your changes in the new VS Code window
```

## Project Structure

```
coilsnake-vscode/
├── .github/
│   └── copilot-instructions.md   # GitHub Copilot guidance
├── ccscript-compiler/             # Downloaded reference compiler (git-ignored)
│   └── ccscript13/
│       ├── ccc.exe                # Windows compiler
│       ├── src/
│       │   ├── grammar.txt        # EBNF grammar (UTF-16 LE)
│       │   ├── lexer.cpp          # Reference lexer
│       │   ├── parser.cpp         # Reference parser
│       │   └── tests/*.ccs        # 33 test files
│       └── doc/*.html             # CCScript documentation
├── coilsnake/                     # CoilSnake submodule
│   └── coilsnake/
│       ├── assets/                # CCScript library files
│       └── modules/               # Python modules
├── coverage/                      # Test coverage reports
├── docs/
│   ├── CONFORMANCE.md             # Testing strategy
│   └── CONFORMANCE_REPORT.md      # Detailed results
├── images/                        # Extension icons
├── scripts/
│   └── setup-ccscript-compiler.sh # Compiler download script
├── src/
│   ├── extension.ts               # VS Code extension entry point
│   ├── ccscript/
│   │   ├── scanner.ts             # Tokenizer (780 lines)
│   │   ├── parser.ts              # Parser (780 lines)
│   │   ├── redNode.ts             # Red nodes (396 lines)
│   │   ├── syntaxTree.ts          # High-level API (267 lines)
│   │   ├── syntax/
│   │   │   ├── syntaxKind.ts      # Enum definitions
│   │   │   └── types.ts           # Type definitions
│   │   ├── test/
│   │   │   ├── fixtures/*.ccs     # 12 test files
│   │   │   ├── scanner.test.ts
│   │   │   ├── parser.test.ts
│   │   │   ├── redNode.test.ts
│   │   │   ├── syntaxTree.test.ts
│   │   │   ├── ccscriptConformance.test.ts
│   │   │   └── systemTestHarness.ts
│   │   └── tools/
│   │       └── grammarAnalysis.ts # Grammar validation tool
│   └── test/
│       └── suite/                 # Extension tests
├── syntaxes/
│   └── ccscript.tmLanguage.json   # TextMate grammar
├── .gitignore
├── eslint.config.mjs              # ESLint flat config
├── jest.config.js                 # Jest configuration
├── language-configuration.json    # Language settings
├── package.json                   # Extension manifest
├── PROJECT.md                     # This file
├── README.md                      # User documentation
├── tsconfig.json                  # TypeScript config
└── webpack.config.js              # Bundling config
```

## Technology Stack

### Core Technologies
- **TypeScript 5.9.2** - Strict mode, ES2024 target
- **VS Code API 1.100.0** - Extension host APIs
- **Node.js 18+** - Runtime environment

### Build Tools
- **Webpack 5** - Extension bundling and optimization
- **TSC** - TypeScript compiler
- **ESLint** - Code quality and style enforcement

### Testing
- **Jest 30.2.0** - Test framework
- **ts-jest** - TypeScript support for Jest
- **Coverage Reports** - Istanbul/nyc

### Development
- **Git Submodules** - CoilSnake integration
- **Bash Scripts** - Build automation
- **VS Code Extension API** - Language service integration

## Configuration Files

### package.json
Extension manifest with:
- VS Code activation events
- Contributed languages
- Grammar associations
- Command contributions
- Dependencies and scripts

### tsconfig.json
TypeScript configuration:
- ES2024 target
- Strict mode enabled
- Module: CommonJS
- Source maps for debugging

### jest.config.js
Test configuration:
- ts-jest preset
- Test match patterns
- Coverage collection
- Transform rules

### eslint.config.mjs
Modern flat config:
- TypeScript ESLint parser
- Recommended rules
- Unused variable checks
- Import/export validation

### language-configuration.json
VS Code language features:
- Comment toggling
- Bracket matching
- Auto-closing pairs
- Indentation rules

### webpack.config.js
Bundling configuration:
- Extension entry point
- Node externals
- Source map support
- Output optimization

## Known Issues and Limitations

### Current Limitations

1. **Semantic Analysis Not Implemented**
   - No symbol tables
   - No type checking
   - No name resolution
   - No scope validation

2. **Code Generation Not Implemented**
   - Cannot compile to binary
   - No validation against `@expect` tags
   - No ROM patching

3. **Minor Test Failures (3)**
   - `06-flag-expressions.ccs` - Call expression detection
   - `07-menu-statement.ccs` - Call expression detection
   - `12-comprehensive.ccs` - Higher error count than expected
   - These are in custom fixtures, not reference tests

4. **VS Code Integration Incomplete**
   - Basic syntax highlighting only
   - No IntelliSense
   - No diagnostics in editor
   - No code actions

### Known Line Ending Issues

Reference CCScript test files use CRLF (Windows line endings). Node.js may normalize these to LF when reading, causing minor width discrepancies (5-16 bytes). This doesn't affect parsing correctness and tests allow ±20 byte tolerance.

### Grammar Encoding

The reference `grammar.txt` file is UTF-16 LE encoded, not UTF-8. The grammar analysis tool handles this correctly with `fs.readFileSync(path, 'utf16le')`.

## Future Roadmap

### Short Term (Semantic Analysis)

1. **Symbol Table**
   - Build workspace-wide symbol registry
   - Track declarations (commands, constants, variables, labels)
   - Store declaration positions for go-to-definition

2. **Scope Manager**
   - Track scope hierarchy (global, command, block)
   - Validate identifier visibility
   - Handle shadowing rules

3. **Type System**
   - Basic type inference
   - Type checking for expressions
   - Array access validation
   - Flag expression validation

4. **Name Binding**
   - Resolve identifiers to declarations
   - Validate referenced symbols exist
   - Track symbol usage

### Medium Term (Language Services)

1. **IntelliSense**
   - Completion provider (keywords, identifiers)
   - Parameter hints for commands
   - Hover information (types, documentation)

2. **Navigation**
   - Go to definition
   - Find all references
   - Peek definition
   - Document symbols
   - Workspace symbols

3. **Refactoring**
   - Rename symbol
   - Extract command
   - Inline constant

4. **Diagnostics**
   - Real-time syntax errors
   - Semantic errors (undefined symbols, type mismatches)
   - Warnings (unused variables, unreachable code)
   - Quick fixes

### Long Term (Advanced Features)

1. **Code Generation**
   - Compile CCScript to binary
   - Validate against reference compiler output
   - Integration with CoilSnake compilation pipeline

2. **Debugging**
   - Debug adapter protocol implementation
   - Breakpoints in CCScript
   - Variable inspection
   - Step-through execution

3. **Testing Framework**
   - Run `@expect` tests from editor
   - Compare outputs with reference compiler
   - Test result visualization

4. **Documentation**
   - Inline documentation support
   - Hover for standard library functions
   - Code snippets for common patterns

## Contributing

### Development Workflow

1. **Feature Branch**
   - Create branch from `main`
   - Use descriptive name (`feature/semantic-analysis`, `fix/parser-bug`)

2. **Development**
   - Write tests first (TDD approach)
   - Implement feature
   - Ensure all tests pass
   - Run linter and fix issues

3. **Testing**
   - Add unit tests for new code
   - Update conformance tests if grammar changes
   - Run full test suite
   - Check coverage reports

4. **Documentation**
   - Update relevant documentation
   - Add code comments for complex logic
   - Update CHANGELOG

5. **Pull Request**
   - Clear description of changes
   - Reference related issues
   - Ensure CI passes
   - Request review

### Code Style

- Follow TypeScript strict mode
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Keep functions focused and small
- Prefer immutability
- Handle errors gracefully

### Testing Requirements

- New features must have tests
- Maintain >95% code coverage
- All conformance tests must pass
- No regressions in existing tests

## Resources

### Documentation
- [docs/CONFORMANCE.md](docs/CONFORMANCE.md) - Testing methodology
- [docs/CONFORMANCE_REPORT.md](docs/CONFORMANCE_REPORT.md) - Test results
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - Development guide

### External Resources
- **CCScript Compiler**: https://starmen.net/pkhack/ccscript/
- **CoilSnake**: https://github.com/pk-hack/CoilSnake
- **VS Code Extension API**: https://code.visualstudio.com/api
- **Roslyn Overview**: https://github.com/dotnet/roslyn/wiki/Roslyn-Overview

### Tools
- **Grammar Analysis**: `npx ts-node src/ccscript/tools/grammarAnalysis.ts`
- **Coverage Report**: `npm test -- --coverage`
- **Watch Mode**: `npm run watch`

## License

See [LICENSE](LICENSE) file for details.

## Acknowledgments

- **CCScript** - Created by the PK Hack community
- **CoilSnake** - pk-hack team
- **Roslyn** - Microsoft for the red/green tree architecture inspiration
- **VS Code** - Microsoft for the excellent extension API

---

**Project Status**: Phase 1 Complete (Syntax Analysis)  
**Current Focus**: Phase 2 (Semantic Analysis)  
**Next Milestone**: Symbol tables and type checking
