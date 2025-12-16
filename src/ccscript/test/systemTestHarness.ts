import * as fs from 'fs';
import * as path from 'path';

/**
 * Test fixture information
 */
export interface TestFixture {
    readonly name: string;
    readonly path: string;
    readonly content: string;
}

/**
 * Result of parsing a test fixture
 */
export interface ParseResult {
    readonly fixture: TestFixture;
    readonly success: boolean;
    readonly diagnostics: unknown[]; // Will use Diagnostic type once parser is implemented
    readonly syntaxTree?: unknown; // Will use proper AST type once parser is implemented
}

/**
 * Test harness for system validation tests
 */
export class SystemTestHarness {
    private readonly fixturesDir: string;

    constructor(fixturesDir?: string) {
        this.fixturesDir = fixturesDir || path.join(__dirname, 'fixtures');
    }

    /**
     * Load all test fixtures from the fixtures directory
     */
    loadAllFixtures(): TestFixture[] {
        const fixtures: TestFixture[] = [];
        const files = fs.readdirSync(this.fixturesDir);

        for (const file of files) {
            if (file.endsWith('.ccs')) {
                const fixturePath = path.join(this.fixturesDir, file);
                const content = fs.readFileSync(fixturePath, 'utf-8');
                fixtures.push({
                    name: file,
                    path: fixturePath,
                    content,
                });
            }
        }

        return fixtures;
    }

    /**
     * Load a specific test fixture by name
     */
    loadFixture(name: string): TestFixture {
        const fixturePath = path.join(this.fixturesDir, name);
        const content = fs.readFileSync(fixturePath, 'utf-8');
        return {
            name,
            path: fixturePath,
            content,
        };
    }

    /**
     * Parse a test fixture (placeholder until parser is implemented)
     */
    parseFixture(fixture: TestFixture): ParseResult {
        // TODO: Implement actual parsing once lexer/parser are ready
        return {
            fixture,
            success: false,
            diagnostics: [
                {
                    message: 'Parser not yet implemented',
                    severity: 'info',
                },
            ],
        };
    }

    /**
     * Validate that a fixture contains expected syntax elements
     */
    validateFixtureContent(fixture: TestFixture, expectations: ContentExpectations): ValidationResult {
        const result: ValidationResult = {
            fixture,
            passed: true,
            failures: [],
        };

        // Check for expected keywords
        if (expectations.keywords) {
            for (const keyword of expectations.keywords) {
                if (!fixture.content.includes(keyword)) {
                    result.passed = false;
                    result.failures.push(`Expected keyword '${keyword}' not found`);
                }
            }
        }

        // Check for expected patterns (regex)
        if (expectations.patterns) {
            for (const [name, pattern] of Object.entries(expectations.patterns)) {
                if (!pattern.test(fixture.content)) {
                    result.passed = false;
                    result.failures.push(`Expected pattern '${name}' not found`);
                }
            }
        }

        // Check minimum line count
        if (expectations.minLines) {
            const lineCount = fixture.content.split('\n').length;
            if (lineCount < expectations.minLines) {
                result.passed = false;
                result.failures.push(
                    `Expected at least ${expectations.minLines} lines, found ${lineCount}`
                );
            }
        }

        return result;
    }

    /**
     * Get fixture statistics
     */
    getFixtureStats(fixture: TestFixture): FixtureStats {
        const lines = fixture.content.split('\n');
        const nonEmptyLines = lines.filter(line => line.trim().length > 0);
        const commentLines = lines.filter(
            line => line.trim().startsWith('//') || line.trim().startsWith('/*')
        );

        return {
            totalLines: lines.length,
            nonEmptyLines: nonEmptyLines.length,
            commentLines: commentLines.length,
            size: fixture.content.length,
        };
    }
}

/**
 * Content expectations for fixture validation
 */
export interface ContentExpectations {
    keywords?: string[];
    patterns?: Record<string, RegExp>;
    minLines?: number;
}

/**
 * Result of validating fixture content
 */
export interface ValidationResult {
    fixture: TestFixture;
    passed: boolean;
    failures: string[];
}

/**
 * Statistics about a fixture
 */
export interface FixtureStats {
    totalLines: number;
    nonEmptyLines: number;
    commentLines: number;
    size: number;
}
