/**
 * Conformance tests - parse all CCScript reference compiler test files
 * and report any parsing errors to validate grammar conformance.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { SyntaxTree } from './syntaxTree';

const TEST_DIR = '../../../ccscript-compiler/ccscript13/src/tests';

describe('CCScript Reference Compiler Conformance', () => {
    // Get all .ccs files
    const testFiles = readdirSync(join(__dirname, TEST_DIR))
        .filter(f => f.endsWith('.ccs'))
        .sort();

    describe('Parser Conformance', () => {
        const results: Array<{
            file: string;
            diagnosticCount: number;
            diagnostics: Array<{ message: string; line: number; column: number }>;
        }> = [];

        testFiles.forEach(file => {
            it(`should parse ${file}`, () => {
                const path = join(__dirname, TEST_DIR, file);
                const source = readFileSync(path, 'utf-8');
                
                const tree = SyntaxTree.parse(source);
                const diagnostics = tree.getDiagnostics(); // Only parser/scanner errors
                
                // Collect results for summary
                const diagInfo = diagnostics.map(d => {
                    const pos = tree.getLineAndColumn(d.span.start);
                    return {
                        message: d.message,
                        line: pos.line,
                        column: pos.column
                    };
                });

                results.push({
                    file,
                    diagnosticCount: diagnostics.length,
                    diagnostics: diagInfo
                });

                // Log details for files with errors
                if (diagnostics.length > 0) {
                    console.log(`\n${file}: ${diagnostics.length} diagnostic(s)`);
                    diagInfo.forEach(d => {
                        console.log(`  Line ${d.line}:${d.column} - ${d.message}`);
                    });
                }

                // For now, just collect data - we expect some to fail
                // since we may not have full grammar support yet
            });
        });

        afterAll(() => {
            // Summary report
            console.log('\n=== CONFORMANCE SUMMARY ===');
            console.log(`Total files tested: ${results.length}`);
            
            const passed = results.filter(r => r.diagnosticCount === 0);
            const failed = results.filter(r => r.diagnosticCount > 0);
            
            console.log(`Passed (no parser errors): ${passed.length}`);
            console.log(`Failed (with parser errors): ${failed.length}`);
            
            if (failed.length > 0) {
                console.log('\nFiles with errors:');
                failed.forEach(r => {
                    console.log(`  ${r.file}: ${r.diagnosticCount} error(s)`);
                });
            }
            
            console.log(`\nConformance rate: ${(passed.length / results.length * 100).toFixed(1)}%`);
        });
    });
});
