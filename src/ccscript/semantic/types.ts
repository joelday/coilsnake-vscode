/**
 * Type system for CCScript semantic analysis.
 * Represents the types available in CCScript and their properties.
 */

/**
 * CCScript primitive types.
 */
export enum TypeKind {
    /** Unknown or error type */
    Unknown,
    /** No value (void) */
    Void,
    /** 8-bit integer (byte) */
    Byte,
    /** 16-bit integer (short) */
    Short,
    /** 32-bit integer (long) */
    Long,
    /** Boolean flag */
    Flag,
    /** String literal */
    String,
    /** Numeric literal that can be any integer type */
    NumericLiteral,
}

/**
 * Represents a type in the CCScript type system.
 */
export interface Type {
    /** The kind of type */
    kind: TypeKind;
    /** Human-readable name */
    name: string;
}

/**
 * Predefined types.
 */
export const Types = {
    unknown: { kind: TypeKind.Unknown, name: 'unknown' } as Type,
    void: { kind: TypeKind.Void, name: 'void' } as Type,
    byte: { kind: TypeKind.Byte, name: 'byte' } as Type,
    short: { kind: TypeKind.Short, name: 'short' } as Type,
    long: { kind: TypeKind.Long, name: 'long' } as Type,
    flag: { kind: TypeKind.Flag, name: 'flag' } as Type,
    string: { kind: TypeKind.String, name: 'string' } as Type,
    numericLiteral: { kind: TypeKind.NumericLiteral, name: 'numeric' } as Type,
};

/**
 * Checks if a type is a numeric type.
 */
export function isNumericType(type: Type): boolean {
    return type.kind === TypeKind.Byte ||
        type.kind === TypeKind.Short ||
        type.kind === TypeKind.Long ||
        type.kind === TypeKind.NumericLiteral;
}

/**
 * Checks if one type is assignable to another.
 */
export function isAssignable(target: Type, source: Type): boolean {
    // Same type is always assignable
    if (target.kind === source.kind) {
        return true;
    }

    // Unknown is assignable to/from anything (error recovery)
    if (target.kind === TypeKind.Unknown || source.kind === TypeKind.Unknown) {
        return true;
    }

    // Numeric literal can be assigned to any numeric type
    if (source.kind === TypeKind.NumericLiteral && isNumericType(target)) {
        return true;
    }

    // Widening conversions are allowed (byte -> short -> long)
    if (target.kind === TypeKind.Short && source.kind === TypeKind.Byte) {
        return true;
    }
    if (target.kind === TypeKind.Long &&
        (source.kind === TypeKind.Byte || source.kind === TypeKind.Short)) {
        return true;
    }

    return false;
}

/**
 * Gets the result type of a binary operation.
 */
export function getBinaryOperationType(leftType: Type, rightType: Type, operator: 'and' | 'or'): Type {
    // Boolean operators always return flag type
    if (operator === 'and' || operator === 'or') {
        return Types.flag;
    }

    return Types.unknown;
}

/**
 * Gets the result type of a unary operation.
 */
export function getUnaryOperationType(operandType: Type, operator: 'not' | 'flag'): Type {
    if (operator === 'not') {
        // not operator on flag returns flag
        if (operandType.kind === TypeKind.Flag) {
            return Types.flag;
        }
    } else if (operator === 'flag') {
        // flag operator on numeric returns flag
        if (isNumericType(operandType)) {
            return Types.flag;
        }
    }

    return Types.unknown;
}
