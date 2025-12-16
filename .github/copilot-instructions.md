# GitHub Copilot Instructions for CoilSnake VSCode Extension

## Project Overview

This is a VS Code extension that provides language services for **CCScript**, the scripting language used by CoilSnake for EarthBound ROM hacking. The project implements a complete language service with parsing, syntax analysis, and eventually semantic analysis and code generation.

## Architecture

### Parser Design: Roslyn Red/Green Tree Pattern

The parser uses Microsoft's Roslyn-inspired **red/green tree** architecture:

**Green Nodes** (Immutable Syntax Data)
- Defined in `src/ccscript/syntax/types.ts`
- Immutable, position-independent syntax nodes
- Shared across multiple trees for memory efficiency
- Contains: kind, width, children, trivia (whitespace/comments)

**Red Nodes** (Positioned Tree Wrappers)
- Defined in `src/ccscript/redNode.ts`
- Positioned wrappers around green nodes
- Lazy child creation with caching
- Parent pointers for tree navigation
- Methods: `getChildren()`, `getAncestors()`, `getDescendants()`, `findNode()`

**Benefits**
- Memory efficient (green nodes are shared)
- Fast cloning and incremental parsing
- Rich navigation API (red nodes)
- Position queries and range-based searches

### Core Components

```
src/ccscript/
├── scanner.ts           # Tokenization with trivia handling
├── parser.ts            # Recursive descent parser with error recovery
├── redNode.ts           # Positioned tree wrapper (red nodes)
├── syntaxTree.ts        # High-level API coordinating scanner/parser
├── syntax/
│   ├── syntaxKind.ts    # ~100 token/node type enums
│   └── types.ts         # Green/Red node type definitions
├── test/
│   ├── fixtures/        # 12 comprehensive .ccs test files
│   ├── scanner.test.ts  # 76 unit tests + 66 fixture tests
│   ├── parser.test.ts   # 51 unit tests
│   ├── redNode.test.ts  # 41 tests
│   ├── syntaxTree.test.ts # 35 tests
│   └── ccscriptConformance.test.ts # 112 conformance tests
└── tools/
    └── grammarAnalysis.ts # Grammar validation tool
```

## CCScript Language

### Reference Implementation

**CCScript 1337 Compiler**
- Download script: `./scripts/setup-ccscript-compiler.sh`
- Location: `ccscript-compiler/ccscript13/` (git-ignored)
- Grammar: `ccscript-compiler/ccscript13/src/grammar.txt` (UTF-16 LE, LL(2))
- Tests: 33 reference `.ccs` files with expected binary outputs

### Grammar Overview (LL(2))

```ebnf
program := ( statement )* EOF

statement := '{' ( statement )* '}'
          | command-def | const-def | var-def | label | rom-write | expression

expression := if-expr | menu-expr | block-expr
           | factor 'and' expression | factor 'or' expression
           | factor | bounds expression

factor := 'flag' primary-expr | INT_LITERAL | STRING_LITERAL
       | '(' expression ')' | 'not' expression

command-def := 'command' IDENTIFIER ['(' params ')'] expression
const-def := 'define' IDENTIFIER '=' expression
var-def := 'var' IDENTIFIER '=' expression
label := IDENTIFIER ':'
rom-write := 'ROM' '[' expression ']' '=' expression
```

### Language Features

**Keywords** (27 total)
- Types: `byte`, `short`, `long`, `size`
- Declarations: `command`, `define`, `var`, `flag`
- Control: `if`, `else`, `menu`, `default`
- Boolean: `and`, `or`, `not`
- ROM: `ROM`, `ROMTBL`

**Features**
- Constant definitions with `define`
- Variable declarations (`var`)
- Command definitions with parameters
- Labels and control flow
- Conditional expressions (`if`/`else`)
- Menu expressions
- Flag checks (`flag expr`)
- Array access with size specifiers (`byte[i]`, `short[i]`, `long[i]`)
- Boolean operations
- ROM/ROMTBL writes
- Block scoping
- String literals with control codes

## Testing Strategy

### Test Organization

**Unit Tests** (297 tests, 100% passing)
- Scanner: 142 tests (76 unit + 66 fixtures)
- Parser: 51 tests
- RedNode: 41 tests  
- SyntaxTree: 35 tests

**Conformance Tests** (112 tests, 100% passing)
- Validates against CCScript 1337 reference compiler
- All 33 reference test files parse successfully
- Grammar completeness verification
- See: `docs/CONFORMANCE_REPORT.md`

**Fixture Tests**
- Location: `src/ccscript/test/fixtures/*.ccs`
- 12 comprehensive test files covering all features
- System test harness in `systemTestHarness.ts`

### Running Tests

```bash
# Full test suite
npm test

# Specific test file
npm test -- scanner.test.ts

# Conformance tests only
npm test -- ccscriptConformance.test.ts

# Grammar analysis
npx ts-node src/ccscript/tools/grammarAnalysis.ts
```

## Code Style Guidelines

### TypeScript

**Strict Mode**: All strict compiler options enabled
- `strict: true`
- `noImplicitAny: true`
- `strictNullChecks: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`

**Naming Conventions**
- Enums: PascalCase (`SyntaxKind`)
- Interfaces/Types: PascalCase (`GreenNode`, `RedNode`)
- Functions: camelCase (`parseStatement()`)
- Private fields: leading underscore (`_position`)
- Constants: UPPER_CASE for true constants

**Immutability**
- Green nodes are immutable (use `readonly`)
- Parser produces new nodes, never modifies existing
- Red nodes cache computed values (lazy evaluation)

### Testing

**Jest Configuration**
- Uses `ts-jest` for TypeScript support
- Coverage enabled (see `coverage/` directory)
- Timeout: 10 seconds for conformance tests

**Test Structure**
```typescript
describe('Feature', () => {
    describe('Subfeature', () => {
        it('should do something specific', () => {
            // Arrange
            const input = '...';
            
            // Act
            const result = SyntaxTree.parse(input);
            
            // Assert
            expect(result).toBeDefined();
        });
    });
});
```

**Fixture Testing Pattern**
```typescript
const fixtures = loadFixtures(); // from systemTestHarness.ts
fixtures.forEach(({ name, content }) => {
    it(`should parse ${name}`, () => {
        const tree = SyntaxTree.parse(content);
        expect(tree.getDiagnostics()).toHaveLength(0);
    });
});
```

## Common Patterns

### Parsing Pattern

```typescript
// High-level API
const tree = SyntaxTree.parse(source);
const root = tree.getRoot();

// Query for nodes
const labels = tree.getLabels();
const constants = tree.getConstants();
const ifStatements = tree.findNodesOfKind(SyntaxKind.IfStatement);

// Position queries
const nodeAtPos = tree.getNodeAtPosition(42);
const { line, column } = tree.getLineAndColumn(42);
```

### Tree Navigation

```typescript
const node = tree.getNodeAtPosition(position);

// Parent chain
const ancestors = node.getAncestors();
const parent = node.getParent();

// Children
const children = node.getChildren();
const descendants = node.getDescendants();

// Siblings
const nextSibling = node.getNextSibling();
const prevSibling = node.getPreviousSibling();

// Token access
if (node.isToken()) {
    console.log(node.text);
}
```

### Error Recovery Pattern

The parser always produces a complete AST, even with syntax errors:

```typescript
const tree = SyntaxTree.parse(invalidSource);
const diagnostics = tree.getDiagnostics();

// Tree is always valid, but may contain Missing* nodes
diagnostics.forEach(diag => {
    console.log(`${diag.message} at ${diag.start}`);
});
```

## Current Status

✅ **Complete: Syntax Layer**
- Scanner with trivia handling
- Parser with error recovery
- Red/Green tree implementation
- SyntaxTree API
- 100% conformance with CCScript 1337

🔄 **In Progress: Semantic Analysis**
- Symbol tables
- Scope management
- Type checking
- Name binding

📋 **Planned: VS Code Integration**
- Syntax highlighting (`.tmLanguage.json` exists)
- IntelliSense (completions, hover)
- Go to definition
- Find all references
- Rename refactoring
- Diagnostics (squiggles)

## Important Files

### Configuration
- `package.json` - Extension manifest and dependencies
- `tsconfig.json` - TypeScript strict mode, ES2024
- `jest.config.js` - Test configuration
- `eslint.config.mjs` - Modern flat config
- `webpack.config.js` - Extension bundling

### Documentation
- `docs/CONFORMANCE.md` - Testing strategy
- `docs/CONFORMANCE_REPORT.md` - Detailed conformance results
- `README.md` - Project overview

### Reference Materials
- `ccscript-compiler/ccscript13/src/grammar.txt` - Official grammar (UTF-16 LE)
- `ccscript-compiler/ccscript13/src/tests/*.ccs` - Reference test files
- `ccscript-compiler/ccscript13/doc/*.html` - CCScript documentation

## Development Workflow

### Adding New Language Features

1. **Update SyntaxKind** (`syntax/syntaxKind.ts`)
   - Add token/node kinds as needed

2. **Extend Scanner** (if new tokens needed)
   - Add keyword recognition in `scanIdentifierOrKeyword()`
   - Add operator recognition in `scan()`
   - Write scanner tests

3. **Extend Parser** (`parser.ts`)
   - Add parsing methods (e.g., `parseNewStatement()`)
   - Update `parseStatement()` or `parseExpression()` dispatch
   - Implement error recovery
   - Write parser tests

4. **Update Type Definitions** (`syntax/types.ts`)
   - Add new node interfaces
   - Update union types

5. **Add Conformance Tests**
   - Validate against reference compiler behavior
   - Check grammar.txt for specification

### Debugging Tips

**Scanner Issues**
- Check trivia handling (whitespace, comments)
- Verify keyword recognition
- Look at token positions and widths

**Parser Issues**
- Check lookahead logic (LL(2) grammar)
- Verify error recovery produces complete trees
- Check that all code paths return nodes

**Tree Navigation Issues**
- Ensure widths are calculated correctly
- Check parent pointer updates
- Verify lazy child creation caching

## External Dependencies

### CoilSnake Submodule
- Location: `coilsnake/` (git submodule)
- Python-based ROM hacking tool
- Contains CCScript library files but not compiler
- See: `coilsnake/coilsnake/assets/modulelist.txt`

### Build Tools
- TypeScript 5.9.2
- Jest 30.2.0 with ts-jest
- ESLint with TypeScript plugin
- Webpack for bundling
- VS Code API 1.100.0

## When Working on This Project

### DO
✅ Follow the red/green tree pattern (immutable green, positioned red)
✅ Write tests for all new features (unit + conformance)
✅ Use strict TypeScript (no `any`, handle nulls)
✅ Implement error recovery (parser should never throw)
✅ Reference grammar.txt for language specification
✅ Run conformance tests after parser changes
✅ Use SyntaxTree API for high-level operations
✅ Cache computed values in red nodes (lazy)

### DON'T
❌ Mutate green nodes (they're immutable)
❌ Skip error recovery in parser
❌ Make parser throw exceptions on syntax errors
❌ Ignore conformance test failures
❌ Use magic numbers (define SyntaxKind constants)
❌ Parse without producing complete AST
❌ Forget to update tests when changing parser

## Resources

- **CCScript Documentation**: `ccscript-compiler/ccscript13/doc/CCScript.html`
- **Grammar Specification**: `ccscript-compiler/ccscript13/src/grammar.txt`
- **Roslyn Overview**: [Microsoft Docs - Roslyn Architecture](https://docs.microsoft.com/en-us/dotnet/csharp/roslyn-sdk/)
- **VS Code Extension Guide**: [VS Code API Documentation](https://code.visualstudio.com/api)

## Contact & Contribution

- Repository: https://github.com/joelday/coilsnake-vscode
- CCScript Compiler: https://starmen.net/pkhack/ccscript/
- CoilSnake: https://github.com/pk-hack/CoilSnake

---

**Remember**: The parser is production-ready. Focus on semantic analysis next (symbol tables, type checking, scope management), then integrate with VS Code language service features.
