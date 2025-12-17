/**
 * Syntax kinds for all possible CCScript nodes.
 * Using enum for efficient discriminated unions and exhaustive checking.
 */
export enum SyntaxKind {
    // Tokens
    EndOfFileToken,
    WhitespaceTrivia,
    NewLineTrivia,
    SingleLineCommentTrivia,
    MultiLineCommentTrivia,
    
    // Literals
    NumericLiteral,
    HexLiteral,
    StringLiteral,
    TrueKeyword,
    FalseKeyword,
    
    // Identifiers
    Identifier,
    
    // Keywords
    AndKeyword,
    ByteKeyword,
    CommandKeyword,
    CountKeyword,
    DefaultKeyword,
    DefineKeyword,
    ElseKeyword,
    FlagKeyword,
    IfKeyword,
    LongKeyword,
    MenuKeyword,
    NotKeyword,
    OrKeyword,
    ROMKeyword,
    ROMTBLKeyword,
    SetcountKeyword,
    ShortKeyword,
    VarKeyword,
    
    // Punctuation
    OpenBraceToken,
    CloseBraceToken,
    OpenBracketToken,
    CloseBracketToken,
    OpenParenToken,
    CloseParenToken,
    ColonToken,
    DotToken,
    CommaToken,
    EqualsToken,
    PipeToken,         // | pause in strings
    SlashToken,        // / pause in strings
    
    // String Components
    StringTextPart,
    ControlCodeSequence,
    
    // Nodes
    SourceFile,
    
    // Statements
    BlockStatement,
    IfStatement,
    MenuStatement,
    MenuOption,
    LabelDeclaration,
    ConstantDeclaration,
    VariableDeclaration,
    CommandDeclaration,
    Parameter,
    ParameterList,
    ROMWriteStatement,
    ROMTableWriteStatement,
    ExpressionStatement,
    
    // Expressions
    NumericLiteralExpression,
    StringLiteralExpression,
    BooleanLiteralExpression,
    IdentifierExpression,
    QualifiedNameExpression,
    CallExpression,
    ArgumentList,
    BinaryExpression,
    UnaryExpression,
    FlagExpression,
    ArrayAccessExpression,
    CountExpression,
    SetcountExpression,
    
    // String template parts
    StringTemplateExpression,
    TemplateSpan,
    
    // Error recovery
    MissingToken,
    UnexpectedToken,
    ErrorStatement,
    ErrorExpression,
}

/**
 * Type guard utilities for syntax kinds
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace SyntaxKind {
    export function isTrivia(kind: SyntaxKind): boolean {
        return kind >= SyntaxKind.WhitespaceTrivia && kind <= SyntaxKind.MultiLineCommentTrivia;
    }
    
    export function isKeyword(kind: SyntaxKind): boolean {
        return kind >= SyntaxKind.AndKeyword && kind <= SyntaxKind.ShortKeyword;
    }
    
    export function isToken(kind: SyntaxKind): boolean {
        return kind <= SyntaxKind.SlashToken;
    }
    
    export function isStatement(kind: SyntaxKind): boolean {
        return kind >= SyntaxKind.BlockStatement && kind <= SyntaxKind.ErrorStatement;
    }
    
    export function isExpression(kind: SyntaxKind): boolean {
        return kind >= SyntaxKind.NumericLiteralExpression && kind <= SyntaxKind.ErrorExpression;
    }
    
    export function isLiteral(kind: SyntaxKind): boolean {
        return kind >= SyntaxKind.NumericLiteral && kind <= SyntaxKind.FalseKeyword;
    }
}
