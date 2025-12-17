# CCScript Parser Conformance Issues

Based on testing against the 33 reference compiler test files, we have **63.6% conformance** (21/33 files parse without errors).

## Issues Found

### 1. Incorrect Keywords (CRITICAL)
**Problem**: `next` and `end` are treated as keywords but should be identifiers.
- `NextKeyword` and `EndKeyword` in SyntaxKind.ts
- These are command names in the standard library, not language keywords
- **Files affected**: hack_shoptest.ccs (11 errors), lib_basic.ccs (2 errors), lib_rom.ccs (3 errors), menus.ccs (4 errors), testfile.ccs (1 error)
- **Fix**: Remove from keyword list in scanner

### 2. Missing `var` Statement Support
**Problem**: Variable declarations with assignment not supported.
- Grammar: `var-def := 'var' IDENTIFIER '=' expression`
- Example: `var test1 = 1`
- **Files affected**: vars.ccs (6 errors)
- **Fix**: Add `VarKeyword`, implement `parseVarDeclaration()` in parser

### 3. Expression Parsing Issues
**Problem**: Cannot call expressions (only identifiers/qualified names).
- Example: `(someFunc())(args)` or similar nested call patterns
- **Files affected**: booleanexpr.ccs (1 error), boundedexpr.ccs (1 error)
- **Fix**: Allow call expressions on any primary expression

### 4. Nested Expression Parsing
**Problem**: Parser expects close paren too early in complex expressions.
- **Files affected**: ifexpr.ccs (1 error), menuexpr.ccs (1 error), scopes.ccs (1 error)
- **Fix**: Review expression precedence and parsing

### 5. Hex Literals in Expressions
**Problem**: Hex literals like `0xffff` not recognized in some contexts.
- **Files affected**: flagexpr.ccs (2 errors)
- **Fix**: Verify hex literal parsing in all expression contexts

## Priority

1. **HIGH**: Fix keywords (#1) - 21 errors across 5 files
2. **MEDIUM**: Add var statement (#2) - 6 errors in 1 file  
3. **LOW**: Expression improvements (#3, #4, #5) - 5 errors across 4 files

## Next Steps

1. Remove `NextKeyword` and `EndKeyword` from SyntaxKind
2. Update scanner to not recognize them as keywords
3. Add `VarKeyword` to SyntaxKind
4. Implement var-def statement parsing
5. Review and fix expression parsing issues
6. Re-run conformance tests
7. Aim for >90% conformance rate
