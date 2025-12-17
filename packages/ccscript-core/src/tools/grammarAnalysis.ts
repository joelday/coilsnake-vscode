/**
 * Grammar Comparison Tool
 * 
 * Compares our parser implementation against the reference CCScript grammar.txt
 * to identify any missing or divergent language features.
 */

import * as fs from 'fs';
import * as path from 'path';

const GRAMMAR_FILE = path.join(__dirname, '../../../ccscript-compiler/ccscript13/src/grammar.txt');

interface GrammarProduction {
    name: string;
    rules: string[];
}

/**
 * Parse grammar.txt into structured productions
 */
export function parseGrammar(): GrammarProduction[] {
    if (!fs.existsSync(GRAMMAR_FILE)) {
        throw new Error(`Grammar file not found at: ${GRAMMAR_FILE}`);
    }

    // Grammar file is UTF-16 LE encoded
    const content = fs.readFileSync(GRAMMAR_FILE, 'utf16le');
    const lines = content.split('\n');
    const productions: GrammarProduction[] = [];
    let currentProduction: GrammarProduction | null = null;

    for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        // Production definition: "name := rule" or "name\t:= rule"
        if (trimmed.includes(':=')) {
            const parts = trimmed.split(':=');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                const rule = parts.slice(1).join(':=').trim();
                currentProduction = { name, rules: rule ? [rule] : [] };
                productions.push(currentProduction);
            }
        }
        // Continuation: "     | rule" or "\t\t\t| rule"
        else if (trimmed.startsWith('|') && currentProduction) {
            const rule = trimmed.substring(1).trim();
            if (rule) {
                currentProduction.rules.push(rule);
            }
        }
    }

    return productions;
}

/**
 * Generate a human-readable summary of the grammar
 */
export function generateGrammarSummary(productions: GrammarProduction[]): string {
    const lines: string[] = [];
    
    lines.push('# CCScript Grammar Summary\n');
    lines.push(`Total Productions: ${productions.length}\n`);
    
    for (const prod of productions) {
        lines.push(`\n## ${prod.name}`);
        lines.push('```');
        lines.push(`${prod.name} :=`);
        for (let i = 0; i < prod.rules.length; i++) {
            const prefix = i === 0 ? '  ' : '| ';
            lines.push(`${prefix}${prod.rules[i]}`);
        }
        lines.push('```');
    }
    
    return lines.join('\n');
}

/**
 * Extract keywords from grammar productions
 */
export function extractKeywords(productions: GrammarProduction[]): Set<string> {
    const keywords = new Set<string>();
    const keywordPattern = /'([^']+)'/g;
    
    for (const prod of productions) {
        for (const rule of prod.rules) {
            let match;
            while ((match = keywordPattern.exec(rule)) !== null) {
                keywords.add(match[1]);
            }
        }
    }
    
    return keywords;
}

/**
 * Analyze grammar coverage
 */
export interface GrammarCoverage {
    totalProductions: number;
    keywords: Set<string>;
    statements: string[];
    expressions: string[];
    primaryExpressions: string[];
}

export function analyzeGrammar(productions: GrammarProduction[]): GrammarCoverage {
    const keywords = extractKeywords(productions);
    
    const statements = productions
        .filter(p => p.name.toLowerCase().includes('statement') || p.name === 'command-def' || 
                     p.name === 'const-def' || p.name === 'var-def')
        .map(p => p.name);
    
    const expressions = productions
        .filter(p => p.name.toLowerCase().includes('expr') || p.name.toLowerCase().includes('expression'))
        .map(p => p.name);
    
    const primaryExpressions = productions
        .filter(p => p.name === 'factor' || p.name === 'primary-expr' || p.name === 'literal')
        .map(p => p.name);
    
    return {
        totalProductions: productions.length,
        keywords,
        statements,
        expressions,
        primaryExpressions,
    };
}

if (require.main === module) {
    try {
        const productions = parseGrammar();
        const summary = generateGrammarSummary(productions);
        const coverage = analyzeGrammar(productions);
        
        console.log(summary);
        console.log('\n# Grammar Coverage Analysis\n');
        console.log(`Total Productions: ${coverage.totalProductions}`);
        console.log(`\nKeywords (${coverage.keywords.size}):`);
        console.log(Array.from(coverage.keywords).sort().join(', '));
        console.log(`\nStatement Productions (${coverage.statements.length}):`);
        console.log(coverage.statements.join(', '));
        console.log(`\nExpression Productions (${coverage.expressions.length}):`);
        console.log(coverage.expressions.join(', '));
        console.log(`\nPrimary Expressions (${coverage.primaryExpressions.length}):`);
        console.log(coverage.primaryExpressions.join(', '));
        
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
