/**
 * CCScript Core - Language parser, semantic analyzer, and type system
 * 
 * This package provides the core language services for CCScript, independent
 * of any specific editor or IDE integration.
 */

// Scanner and Parser
export { Scanner } from './src/scanner';
export { Parser } from './src/parser';
export { SyntaxTree, TreeStatistics } from './src/syntaxTree';

// Syntax Tree
export { RedNode, RedToken, RedSourceFile, createRedNode, createRedTree } from './src/redNode';
export { SyntaxKind } from './src/syntax/syntaxKind';
export * from './src/syntax/types';

// Semantic Analysis
export * from './src/semantic';
