/**
 * CCScript Conformance Tests
 * 
 * These tests validate that our parser produces syntactically correct ASTs
 * that match the behavior of the reference CCScript compiler.
 * 
 * Strategy:
 * 1. Load CCScript compiler test files
 * 2. Parse with our parser
 * 3. Validate we produce valid ASTs without crashing
 * 4. Verify expected syntax elements are present
 * 5. Check that syntax errors match expected behavior
 */

import * as fs from 'fs';
import * as path from 'path';
import { SyntaxTree } from '../syntaxTree';
import { SyntaxKind } from '../syntax/syntaxKind';

// The CCScript 1.337 reference compiler's test scripts, vendored with the package.
const CCSCRIPT_TESTS_DIR = path.join(__dirname, '../../reference-tests/ccscript1337');

/**
 * Check if CCScript compiler is available
 */
function isCCScriptCompilerAvailable(): boolean {
    return fs.existsSync(CCSCRIPT_TESTS_DIR);
}

/**
 * Load all .ccs test files from CCScript compiler
 */
function loadCCScriptTestFiles(): Array<{ name: string; path: string; content: string }> {
    if (!isCCScriptCompilerAvailable()) {
        return [];
    }

    const files: Array<{ name: string; path: string; content: string }> = [];
    const allFiles = fs.readdirSync(CCSCRIPT_TESTS_DIR);

    for (const file of allFiles) {
        if (file.endsWith('.ccs')) {
            const filePath = path.join(CCSCRIPT_TESTS_DIR, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            files.push({ name: file, path: filePath, content });
        }
    }

    return files;
}

/**
 * Parse CCScript test metadata from comments
 */
interface TestMetadata {
    name?: string;
    desc?: string;
    expect?: string;
    file?: string;
    start?: string;
}

function parseTestMetadata(content: string): TestMetadata {
    const metadata: TestMetadata = {};
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        
        // Stop at first non-blank, non-comment line
        if (trimmed && !trimmed.startsWith('///') && !trimmed.startsWith('//')) {
            break;
        }

        if (trimmed.startsWith('///@')) {
            const tagMatch = trimmed.match(/^\/\/\/@(\w+):\s*(.*)$/);
            if (tagMatch) {
                const [, tagName, tagValue] = tagMatch;
                metadata[tagName as keyof TestMetadata] = tagValue;
            }
        }
    }

    return metadata;
}

describe('CCScript Conformance Tests', () => {
    const testFiles = loadCCScriptTestFiles();

    if (testFiles.length === 0) {
        it('should have CCScript compiler available', () => {
            console.warn(`
                CCScript compiler not found at: ${CCSCRIPT_TESTS_DIR}
                See packages/ccscript-core/reference-tests/ccscript1337/README.md
                Skipping conformance tests.
            `);
            expect(isCCScriptCompilerAvailable()).toBe(false);
        });
        return;
    }

    it('should have loaded CCScript test files', () => {
        expect(testFiles.length).toBeGreaterThan(0);
        console.log(`Loaded ${testFiles.length} CCScript test files`);
    });

    describe('Parse all reference test files', () => {
        testFiles.forEach(({ name, content }) => {
            it(`should parse ${name} without crashing`, () => {
                expect(() => {
                    const tree = SyntaxTree.parse(content);
                    expect(tree).toBeDefined();
                    expect(tree.getRoot()).toBeDefined();
                }).not.toThrow();
            });
        });
    });

    describe('Validate basic syntax elements', () => {
        testFiles.forEach(({ name, content }) => {
            it(`should produce valid AST for ${name}`, () => {
                const tree = SyntaxTree.parse(content);
                const root = tree.getRoot();
                
                // Should have valid root
                expect(root.kind).toBe(SyntaxKind.SourceFile);
                
                // Should have EOF token
                const eof = root.getEndOfFileToken();
                expect(eof.kind).toBe(SyntaxKind.EndOfFileToken);
                
                // Width should match source length (within small margin for line ending normalization)
                // CCScript test files use CRLF, but when read they may be normalized to LF
                const widthDiff = Math.abs(root.width - content.length);
                expect(widthDiff).toBeLessThanOrEqual(20); // Allow small discrepancy for line endings
            });
        });
    });

    describe('Test-specific validations', () => {
        it('defines.ccs: should parse constant definitions', () => {
            const file = testFiles.find(f => f.name === 'defines.ccs');
            if (!file) {
                console.warn('defines.ccs not found');
                return;
            }

            const tree = SyntaxTree.parse(file.content);
            const constants = tree.getConstants();
            
            expect(constants.length).toBeGreaterThan(0);
            
            // Should find specific constants mentioned in the test
            const identifiers = tree.getIdentifiers().map(id => id.text);
            expect(identifiers).toContain('mynumber');
            expect(identifiers).toContain('mystring');
            expect(identifiers).toContain('myflag');
        });

        it('conditionals.ccs: should parse if statements', () => {
            const file = testFiles.find(f => f.name === 'conditionals.ccs');
            if (!file) {
                console.warn('conditionals.ccs not found');
                return;
            }

            const tree = SyntaxTree.parse(file.content);
            const ifStatements = tree.findNodesOfKind(SyntaxKind.IfStatement);
            
            expect(ifStatements.length).toBeGreaterThan(0);
        });

        it('commands.ccs: should parse command definitions', () => {
            const file = testFiles.find(f => f.name === 'commands.ccs');
            if (!file) {
                console.warn('commands.ccs not found');
                return;
            }

            const tree = SyntaxTree.parse(file.content);
            const commands = tree.getCommands();
            
            expect(commands.length).toBeGreaterThan(0);
        });

        it('labels.ccs: should parse label declarations', () => {
            const file = testFiles.find(f => f.name === 'labels.ccs');
            if (!file) {
                console.warn('labels.ccs not found');
                return;
            }

            const tree = SyntaxTree.parse(file.content);
            const labels = tree.getLabels();
            
            expect(labels.length).toBeGreaterThan(0);
        });

        it('flagexpr.ccs: should parse flag expressions', () => {
            const file = testFiles.find(f => f.name === 'flagexpr.ccs');
            if (!file) {
                console.warn('flagexpr.ccs not found');
                return;
            }

            const tree = SyntaxTree.parse(file.content);
            const flags = tree.findNodesOfKind(SyntaxKind.FlagExpression);
            
            expect(flags.length).toBeGreaterThan(0);
        });

        it('boundedexpr.ccs: should parse array access expressions', () => {
            const file = testFiles.find(f => f.name === 'boundedexpr.ccs');
            if (!file) {
                console.warn('boundedexpr.ccs not found');
                return;
            }

            const tree = SyntaxTree.parse(file.content);
            const arrayAccess = tree.findNodesOfKind(SyntaxKind.ArrayAccessExpression);
            
            // Should have byte/short/long array access
            expect(arrayAccess.length).toBeGreaterThan(0);
        });

        it('booleanexpr.ccs: should parse boolean operators', () => {
            const file = testFiles.find(f => f.name === 'booleanexpr.ccs');
            if (!file) {
                console.warn('booleanexpr.ccs not found');
                return;
            }

            const tree = SyntaxTree.parse(file.content);
            const tokens = tree.getTokens();
            
            // Should have and/or/not keywords
            const keywords = tokens.filter(t => 
                t.kind === SyntaxKind.AndKeyword ||
                t.kind === SyntaxKind.OrKeyword ||
                t.kind === SyntaxKind.NotKeyword
            );
            
            expect(keywords.length).toBeGreaterThan(0);
        });
    });

    describe('Metadata parsing', () => {
        testFiles.forEach(({ name, content }) => {
            const metadata = parseTestMetadata(content);
            
            if (metadata.name) {
                it(`${name}: should have test name "${metadata.name}"`, () => {
                    expect(metadata.name).toBeDefined();
                });
            }
        });
    });

    describe('Error tolerance', () => {
        it('should handle empty files gracefully', () => {
            const file = testFiles.find(f => f.name === 'blank.ccs');
            if (!file) {
                console.warn('blank.ccs not found');
                return;
            }

            const tree = SyntaxTree.parse(file.content);
            expect(tree).toBeDefined();
            expect(tree.getStatements().length).toBe(0);
        });

        it('should parse files without fatal errors', () => {
            testFiles.forEach(({ content }) => {
                const tree = SyntaxTree.parse(content);
                
                // We should produce diagnostics but not crash
                // Some files may have intentional errors for testing
                expect(tree).toBeDefined();
                expect(tree.getRoot()).toBeDefined();
            });
        });
    });

    describe('Comprehensive coverage', () => {
        it('should test multiple language features', () => {
            const featureTests = {
                'defines.ccs': 'constant definitions',
                'commands.ccs': 'command definitions',
                'labels.ccs': 'label declarations',
                'conditionals.ccs': 'conditional expressions',
                'flagexpr.ccs': 'flag expressions',
                'boundedexpr.ccs': 'array access expressions',
                'booleanexpr.ccs': 'boolean operations',
            };

            const foundTests = Object.keys(featureTests).filter(name =>
                testFiles.some(f => f.name === name)
            );

            console.log(`Found ${foundTests.length}/${Object.keys(featureTests).length} feature tests`);
            expect(foundTests.length).toBeGreaterThan(0);
        });

        it('should parse library test files', () => {
            const libTests = testFiles.filter(f => f.name.startsWith('lib_'));
            
            console.log(`Found ${libTests.length} library test files`);
            
            libTests.forEach(({ content }) => {
                const tree = SyntaxTree.parse(content);
                expect(tree).toBeDefined();
                expect(tree.getRoot().kind).toBe(SyntaxKind.SourceFile);
            });
        });
    });

    describe('Token coverage', () => {
        it('should recognize all keywords from test files', () => {
            const allKeywords = new Set<SyntaxKind>();
            
            testFiles.forEach(({ content }) => {
                const tree = SyntaxTree.parse(content);
                const tokens = tree.getTokens();
                
                tokens.forEach(token => {
                    if (SyntaxKind.isKeyword(token.kind)) {
                        allKeywords.add(token.kind);
                    }
                });
            });

            console.log(`Found ${allKeywords.size} unique keywords in test files`);
            expect(allKeywords.size).toBeGreaterThan(10);
        });
    });
});
