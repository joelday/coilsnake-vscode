/**
 * CCScript Semantic Analysis Module
 * 
 * This module provides semantic analysis capabilities for CCScript including:
 * - Symbol tables for tracking declarations
 * - Scope management for identifier visibility
 * - Type system for type inference and checking
 * - Name binding for resolving references
 */

// Core semantic analysis
export { Binder, BindingResult, SemanticDiagnostic, DeferredDeclaration } from './binder';

// Symbol table
export { Symbol, SymbolKind, SymbolTable } from './symbol';

// Scope management
export { Scope, ScopeKind, ScopeManager } from './scope';

// Type system
export {
    Type,
    TypeKind,
    Types,
    isNumericType,
    isAssignable,
    getBinaryOperationType,
    getUnaryOperationType,
} from './types';
