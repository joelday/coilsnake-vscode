/**
 * Type definitions for the CCScript syntax tree.
 * Roslyn-inspired Red/Green tree pattern:
 * - Green nodes: Immutable, position-independent, cached and reused
 * - Red nodes: Positional wrappers around green nodes with parent pointers
 * 
 * Design principles:
 * - Green nodes are the source of truth
 * - Red nodes provide navigation and position information
 * - All nodes in syntax order for proper iteration
 */

import { SyntaxKind } from './syntaxKind';

// ========== Core Types ==========

/**
 * Text span representing a position in source code
 */
export interface TextSpan {
    readonly start: number;
    readonly length: number;
}

/**
 * Diagnostic severity levels
 */
export enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
    Hint,
}

/**
 * A diagnostic message (error, warning, etc.)
 */
export interface Diagnostic {
    readonly span: TextSpan;
    readonly severity: DiagnosticSeverity;
    readonly message: string;
    readonly code?: string;
}

// ========== Green Tree (Position-Independent) ==========

/**
 * Base interface for all green nodes (immutable, position-independent syntax)
 * Following Roslyn's design:
 * - fullWidth: total width including leading and trailing trivia
 * - Width (computed): fullWidth - leadingTriviaWidth - trailingTriviaWidth
 */
export interface GreenNode {
    readonly kind: SyntaxKind;
    readonly fullWidth: number;  // Total width including all trivia
    readonly children: readonly GreenElement[];
}

/**
 * Token - a leaf node in the syntax tree
 * fullWidth = leadingTriviaWidth + text.length + trailingTriviaWidth
 */
export interface GreenToken extends GreenNode {
    readonly text: string;
    readonly leadingTrivia?: readonly GreenTrivia[];
    readonly trailingTrivia?: readonly GreenTrivia[];
}

/**
 * Trivia - whitespace and comments
 */
export interface GreenTrivia {
    readonly kind: SyntaxKind;
    readonly text: string;
    readonly width: number;
}

/**
 * A green element can be either a token or a non-token node
 */
export type GreenElement = GreenToken | GreenNode;

// ========== Red Tree (Position-Aware) ==========

/**
 * Red node - wraps green node with position information and parent reference
 * Cached for efficiency - multiple red nodes can share same green node at different positions
 */
export interface RedNode<G extends GreenNode = GreenNode> {
    readonly kind: G['kind'];
    readonly green: G;
    readonly parent: RedNode | null;
    readonly position: number;  // Absolute position in source text

    // Computed properties
    get span(): TextSpan;
    get end(): number;

    // Navigation
    getChildAt(index: number): RedNode | null;
    getChildren(): readonly RedNode[];
}

/**
 * Interface for nodes that have text content (tokens)
 */
export interface IHasText {
    readonly text: string;
}

/**
 * Interface for nodes that have associated trivia (whitespace/comments)
 */
export interface IHasTrivia {
    getLeadingTrivia(): readonly GreenTrivia[];
    getTrailingTrivia(): readonly GreenTrivia[];
}

/**
 * Interface for red token nodes - combines RedNode with text and trivia
 */
export interface IRedToken extends RedNode<GreenToken>, IHasText, IHasTrivia {
}

// ========== Visitor Pattern ==========

/**
 * Visitor for traversing the syntax tree
 */
export interface SyntaxVisitor<T = void> {
    visitNode(node: RedNode): T;
    visitToken(token: RedNode<GreenToken>): T;
}

// ========== Specific Green Node Types ==========

/**
 * Source file - root of the syntax tree
 */
export interface GreenSourceFile extends GreenNode {
    readonly kind: SyntaxKind.SourceFile;
    readonly statements: readonly GreenStatement[];
    readonly endOfFileToken: GreenToken;
}

// ========== Statements ==========

export type GreenStatement =
    | GreenBlockStatement
    | GreenIfStatement
    | GreenImportStatement
    | GreenMenuStatement
    | GreenLabelDeclaration
    | GreenConstantDeclaration
    | GreenVariableDeclaration
    | GreenCommandDeclaration
    | GreenROMWriteStatement
    | GreenROMTableWriteStatement
    | GreenExpressionStatement
    | GreenErrorStatement;

export interface GreenBlockStatement extends GreenNode {
    readonly kind: SyntaxKind.BlockStatement;
    readonly openBrace: GreenToken;
    readonly statements: readonly GreenStatement[];
    readonly closeBrace: GreenToken;
}

export interface GreenIfStatement extends GreenNode {
    readonly kind: SyntaxKind.IfStatement;
    readonly ifKeyword: GreenToken;
    readonly condition: GreenExpression;
    readonly thenStatement: GreenStatement;
    readonly elseKeyword?: GreenToken;
    readonly elseStatement?: GreenStatement;
}

export interface GreenImportStatement extends GreenNode {
    readonly kind: SyntaxKind.ImportStatement;
    readonly importKeyword: GreenToken;
    readonly path: GreenToken;  // Identifier or StringLiteral
}

export interface GreenMenuStatement extends GreenNode {
    readonly kind: SyntaxKind.MenuStatement;
    readonly menuKeyword: GreenToken;
    readonly columns?: GreenToken;  // numeric literal
    readonly openBrace: GreenToken;
    readonly options: readonly GreenMenuOption[];
    readonly closeBrace: GreenToken;
}

export interface GreenMenuOption extends GreenNode {
    readonly kind: SyntaxKind.MenuOption;
    readonly defaultKeyword?: GreenToken;
    readonly label: GreenExpression;
    readonly colon: GreenToken;
    readonly statement: GreenStatement;
}

/**
 * Parameter list - encapsulates parameter identifiers with comma separators
 */
export interface GreenParameterList extends GreenNode {
    readonly kind: SyntaxKind.ParameterList;
    readonly openParen: GreenToken;
    readonly parameters: readonly GreenToken[];  // identifiers only
    readonly closeParen: GreenToken;
}

/**
 * Argument list - encapsulates argument expressions with comma separators
 */
export interface GreenArgumentList extends GreenNode {
    readonly kind: SyntaxKind.ArgumentList;
    readonly openParen: GreenToken;
    readonly arguments: readonly GreenExpression[];  // expressions only
    readonly closeParen: GreenToken;
}

export interface GreenLabelDeclaration extends GreenNode {
    readonly kind: SyntaxKind.LabelDeclaration;
    readonly identifier: GreenToken;
    readonly colon: GreenToken;
}

export interface GreenConstantDeclaration extends GreenNode {
    readonly kind: SyntaxKind.ConstantDeclaration;
    readonly defineKeyword: GreenToken;
    readonly identifier: GreenToken;
    readonly equals: GreenToken;
    readonly value: GreenExpression;
}

export interface GreenVariableDeclaration extends GreenNode {
    readonly kind: SyntaxKind.VariableDeclaration;
    readonly varKeyword: GreenToken;
    readonly identifier: GreenToken;
    readonly equals: GreenToken;
    readonly value: GreenExpression;
}

export interface GreenCommandDeclaration extends GreenNode {
    readonly kind: SyntaxKind.CommandDeclaration;
    readonly commandKeyword: GreenToken;
    readonly identifier: GreenToken;
    readonly parameterList?: GreenParameterList;
    readonly body: GreenStatement;
}

export interface GreenROMWriteStatement extends GreenNode {
    readonly kind: SyntaxKind.ROMWriteStatement;
    readonly romKeyword: GreenToken;
    readonly openBracket: GreenToken;
    readonly address: GreenExpression;
    readonly closeBracket: GreenToken;
    readonly equals: GreenToken;
    readonly value: GreenExpression;
}

export interface GreenROMTableWriteStatement extends GreenNode {
    readonly kind: SyntaxKind.ROMTableWriteStatement;
    readonly romtblKeyword: GreenToken;
    readonly openBracket: GreenToken;
    readonly base: GreenExpression;
    readonly comma1: GreenToken;
    readonly size: GreenExpression;
    readonly comma2: GreenToken;
    readonly index: GreenExpression;
    readonly closeBracket: GreenToken;
    readonly equals: GreenToken;
    readonly value: GreenExpression;
}

export interface GreenExpressionStatement extends GreenNode {
    readonly kind: SyntaxKind.ExpressionStatement;
    readonly expression: GreenExpression;
}

export interface GreenErrorStatement extends GreenNode {
    readonly kind: SyntaxKind.ErrorStatement;
    readonly errorToken: GreenToken;
}

// ========== Expressions ==========

export type GreenExpression =
    | GreenNumericLiteralExpression
    | GreenStringLiteralExpression
    | GreenBooleanLiteralExpression
    | GreenIdentifierExpression
    | GreenQualifiedNameExpression
    | GreenCallExpression
    | GreenBinaryExpression
    | GreenUnaryExpression
    | GreenFlagExpression
    | GreenArrayAccessExpression
    | GreenStringTemplateExpression
    | GreenCountExpression
    | GreenSetcountExpression
    | GreenIfStatement          // if can be used as expression
    | GreenMenuStatement        // menu can be used as expression
    | GreenBlockStatement       // blocks can be used as expressions
    | GreenErrorExpression;

export interface GreenNumericLiteralExpression extends GreenNode {
    readonly kind: SyntaxKind.NumericLiteralExpression;
    readonly token: GreenToken;
}

export interface GreenStringLiteralExpression extends GreenNode {
    readonly kind: SyntaxKind.StringLiteralExpression;
    readonly parts: readonly (GreenToken | GreenStringTemplateExpression)[];
}

export interface GreenBooleanLiteralExpression extends GreenNode {
    readonly kind: SyntaxKind.BooleanLiteralExpression;
    readonly token: GreenToken;
}

export interface GreenIdentifierExpression extends GreenNode {
    readonly kind: SyntaxKind.IdentifierExpression;
    readonly identifier: GreenToken;
}

export interface GreenQualifiedNameExpression extends GreenNode {
    readonly kind: SyntaxKind.QualifiedNameExpression;
    readonly left: GreenToken;  // module name
    readonly dot: GreenToken;
    readonly right: GreenToken;  // identifier
}

export interface GreenCallExpression extends GreenNode {
    readonly kind: SyntaxKind.CallExpression;
    readonly target: GreenIdentifierExpression | GreenQualifiedNameExpression;
    readonly argumentList: GreenArgumentList;
}

export interface GreenBinaryExpression extends GreenNode {
    readonly kind: SyntaxKind.BinaryExpression;
    readonly left: GreenExpression;
    readonly operator: GreenToken;
    readonly right: GreenExpression;
}

export interface GreenUnaryExpression extends GreenNode {
    readonly kind: SyntaxKind.UnaryExpression;
    readonly operator: GreenToken;
    readonly operand: GreenExpression;
}

export interface GreenFlagExpression extends GreenNode {
    readonly kind: SyntaxKind.FlagExpression;
    readonly flagKeyword: GreenToken;
    readonly operand: GreenExpression;  // Can be any primary expression
}

export interface GreenArrayAccessExpression extends GreenNode {
    readonly kind: SyntaxKind.ArrayAccessExpression;
    readonly typeKeyword: GreenToken;  // byte, short, long
    readonly openBracket?: GreenToken;
    readonly indexValue?: GreenToken;
    readonly closeBracket?: GreenToken;
    readonly expression: GreenExpression;
}

export interface GreenStringTemplateExpression extends GreenNode {
    readonly kind: SyntaxKind.StringTemplateExpression;
    readonly openBrace: GreenToken;
    readonly expression: GreenExpression;
    readonly closeBrace: GreenToken;
}

export interface GreenCountExpression extends GreenNode {
    readonly kind: SyntaxKind.CountExpression;
    readonly countKeyword: GreenToken;
    readonly counterName: GreenToken;  // string literal
}

export interface GreenSetcountExpression extends GreenNode {
    readonly kind: SyntaxKind.SetcountExpression;
    readonly setcountKeyword: GreenToken;
    readonly counterName: GreenToken;   // string literal
    readonly valueExpr: GreenExpression; // can be negative number (unary expr)
}

export interface GreenErrorExpression extends GreenNode {
    readonly kind: SyntaxKind.ErrorExpression;
    readonly errorToken: GreenToken;
}

// ========== Type Utilities ==========

/**
 * Extract the green node type for a given syntax kind
 */
export type GreenNodeOfKind<K extends SyntaxKind> =
    K extends SyntaxKind.SourceFile ? GreenSourceFile :
    K extends SyntaxKind.BlockStatement ? GreenBlockStatement :
    K extends SyntaxKind.IfStatement ? GreenIfStatement :
    K extends SyntaxKind.MenuStatement ? GreenMenuStatement :
    K extends SyntaxKind.MenuOption ? GreenMenuOption :
    K extends SyntaxKind.ParameterList ? GreenParameterList :
    K extends SyntaxKind.ArgumentList ? GreenArgumentList :
    K extends SyntaxKind.LabelDeclaration ? GreenLabelDeclaration :
    K extends SyntaxKind.ConstantDeclaration ? GreenConstantDeclaration :
    K extends SyntaxKind.CommandDeclaration ? GreenCommandDeclaration :
    K extends SyntaxKind.ROMWriteStatement ? GreenROMWriteStatement :
    K extends SyntaxKind.ROMTableWriteStatement ? GreenROMTableWriteStatement :
    K extends SyntaxKind.ExpressionStatement ? GreenExpressionStatement :
    K extends SyntaxKind.ErrorStatement ? GreenErrorStatement :
    K extends SyntaxKind.NumericLiteralExpression ? GreenNumericLiteralExpression :
    K extends SyntaxKind.StringLiteralExpression ? GreenStringLiteralExpression :
    K extends SyntaxKind.BooleanLiteralExpression ? GreenBooleanLiteralExpression :
    K extends SyntaxKind.IdentifierExpression ? GreenIdentifierExpression :
    K extends SyntaxKind.QualifiedNameExpression ? GreenQualifiedNameExpression :
    K extends SyntaxKind.CallExpression ? GreenCallExpression :
    K extends SyntaxKind.BinaryExpression ? GreenBinaryExpression :
    K extends SyntaxKind.UnaryExpression ? GreenUnaryExpression :
    K extends SyntaxKind.FlagExpression ? GreenFlagExpression :
    K extends SyntaxKind.ArrayAccessExpression ? GreenArrayAccessExpression :
    K extends SyntaxKind.StringTemplateExpression ? GreenStringTemplateExpression :
    K extends SyntaxKind.ErrorExpression ? GreenErrorExpression :
    GreenNode;

/**
 * Type guard for checking node kinds
 */
export function isNodeOfKind<K extends SyntaxKind>(
    node: GreenNode | RedNode,
    kind: K
): node is GreenNodeOfKind<K> | RedNode<GreenNodeOfKind<K>> {
    return node.kind === kind;
}
