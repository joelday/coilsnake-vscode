import { SystemTestHarness } from './systemTestHarness';

describe('CCScript System Validation Tests', () => {
    let harness: SystemTestHarness;

    beforeAll(() => {
        harness = new SystemTestHarness();
    });

    describe('Test fixtures', () => {
        it('should load all test fixtures', () => {
            const fixtures = harness.loadAllFixtures();
            expect(fixtures.length).toBeGreaterThan(0);
            fixtures.forEach(fixture => {
                expect(fixture.name).toBeDefined();
                expect(fixture.path).toBeDefined();
                expect(fixture.content).toBeDefined();
                expect(fixture.content.length).toBeGreaterThan(0);
            });
        });

        it('should load individual fixtures by name', () => {
            const fixture = harness.loadFixture('01-literals.ccs');
            expect(fixture.name).toBe('01-literals.ccs');
            expect(fixture.content).toContain('define');
        });
    });

    describe('01-literals.ccs', () => {
        it('should contain literal definitions', () => {
            const fixture = harness.loadFixture('01-literals.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: ['define'],
                patterns: {
                    numeric: /\d+/,
                    hex: /0x[0-9A-Fa-f]+/,
                    string: /"[^"]*"/,
                    boolean: /\b(true|false)\b/,
                },
            });
            expect(result.passed).toBe(true);
            if (!result.passed) {
                console.log('Failures:', result.failures);
            }
        });

        it('should have reasonable statistics', () => {
            const fixture = harness.loadFixture('01-literals.ccs');
            const stats = harness.getFixtureStats(fixture);
            expect(stats.totalLines).toBeGreaterThan(0);
            expect(stats.nonEmptyLines).toBeGreaterThan(0);
        });
    });

    describe('02-operators.ccs', () => {
        it('should contain operator expressions', () => {
            const fixture = harness.loadFixture('02-operators.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: ['define', 'and', 'or', 'not'],
                patterns: {
                    arithmetic: /[+\-*/%]/,
                    comparison: /[<>=!]+/,
                    logical: /\b(and|or|not)\b/,
                },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe('03-strings.ccs', () => {
        it('should contain string literals and templates', () => {
            const fixture = harness.loadFixture('03-strings.ccs');
            const result = harness.validateFixtureContent(fixture, {
                patterns: {
                    string: /"[^"]*"/,
                    controlCode: /\[[\dA-F\s]+\]/,
                    template: /\{[^}]+\}/,
                },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe('04-conditionals.ccs', () => {
        it('should contain if/else statements', () => {
            const fixture = harness.loadFixture('04-conditionals.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: ['if', 'else'],
                patterns: {
                    ifStatement: /\bif\b/,
                    elseClause: /\belse\b/,
                    block: /\{[^}]*\}/s,
                },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe('05-menus.ccs', () => {
        it('should contain menu statements', () => {
            const fixture = harness.loadFixture('05-menus.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: ['menu', 'default'],
                patterns: {
                    menu: /\bmenu\b/,
                    menuOption: /"[^"]*"\s*:/,
                },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe('06-commands.ccs', () => {
        it('should contain command declarations', () => {
            const fixture = harness.loadFixture('06-commands.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: ['command'],
                patterns: {
                    commandDecl: /\bcommand\s+\w+/,
                    parameters: /\([^)]*\)/,
                },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe('07-rom-access.ccs', () => {
        it('should contain ROM access statements', () => {
            const fixture = harness.loadFixture('07-rom-access.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: ['rom', 'romtbl'],
                patterns: {
                    romWrite: /\brom\s*\[/,
                    romtblWrite: /\bromtbl\s*\[/,
                },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe('08-array-access.ccs', () => {
        it('should contain array access expressions', () => {
            const fixture = harness.loadFixture('08-array-access.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: ['byte', 'short', 'long'],
                patterns: {
                    byteAccess: /\bbyte\b/,
                    shortAccess: /\bshort\b/,
                    longAccess: /\blong\b/,
                },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe('09-flags.ccs', () => {
        it('should contain flag expressions', () => {
            const fixture = harness.loadFixture('09-flags.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: ['flag'],
                patterns: {
                    flagExpr: /\bflag\s+\d+/,
                },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe('10-comments.ccs', () => {
        it('should contain various comment styles', () => {
            const fixture = harness.loadFixture('10-comments.ccs');
            const result = harness.validateFixtureContent(fixture, {
                patterns: {
                    singleLineComment: /\/\//,
                    multiLineComment: /\/\*[\s\S]*?\*\//,
                },
            });
            expect(result.passed).toBe(true);
        });

        it('should have comment lines in statistics', () => {
            const fixture = harness.loadFixture('10-comments.ccs');
            const stats = harness.getFixtureStats(fixture);
            expect(stats.commentLines).toBeGreaterThan(0);
        });
    });

    describe('11-qualified-names.ccs', () => {
        it('should contain qualified names', () => {
            const fixture = harness.loadFixture('11-qualified-names.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: ['import'],
                patterns: {
                    qualifiedName: /\w+\.\w+/,
                },
            });
            expect(result.passed).toBe(true);
        });
    });

    describe('12-comprehensive.ccs', () => {
        it('should be a comprehensive test combining all features', () => {
            const fixture = harness.loadFixture('12-comprehensive.ccs');
            const result = harness.validateFixtureContent(fixture, {
                keywords: [
                    'import',
                    'define',
                    'command',
                    'if',
                    'else',
                    'menu',
                    'rom',
                    'romtbl',
                    'flag',
                ],
                minLines: 50,
            });
            expect(result.passed).toBe(true);
        });

        it('should have substantial content', () => {
            const fixture = harness.loadFixture('12-comprehensive.ccs');
            const stats = harness.getFixtureStats(fixture);
            expect(stats.totalLines).toBeGreaterThan(50);
            expect(stats.nonEmptyLines).toBeGreaterThan(30);
        });
    });

    describe('Fixture coverage', () => {
        it('should have fixtures for all major language features', () => {
            const fixtures = harness.loadAllFixtures();
            const fixtureNames = fixtures.map(f => f.name);

            // Expected fixtures
            const expectedFixtures = [
                '01-literals.ccs',
                '02-operators.ccs',
                '03-strings.ccs',
                '04-conditionals.ccs',
                '05-menus.ccs',
                '06-commands.ccs',
                '07-rom-access.ccs',
                '08-array-access.ccs',
                '09-flags.ccs',
                '10-comments.ccs',
                '11-qualified-names.ccs',
                '12-comprehensive.ccs',
            ];

            expectedFixtures.forEach(expected => {
                expect(fixtureNames).toContain(expected);
            });
        });

        it('should cover all syntax kinds in fixtures', () => {
            const fixtures = harness.loadAllFixtures();
            const allContent = fixtures.map(f => f.content).join('\n');

            // Verify major syntax elements appear somewhere in fixtures
            const requiredElements = [
                // Keywords
                'define', 'command', 'if', 'else', 'menu', 'flag',
                'rom', 'romtbl', 'byte', 'short', 'long',
                'and', 'or', 'not', 'true', 'false',
                // Patterns
                /\d+/,                    // numeric literals
                /0x[0-9A-Fa-f]+/,        // hex literals
                /"[^"]*"/,                // strings
                /\{[^}]+\}/,              // templates or blocks
                /\[[^\]]+\]/,             // brackets (arrays, ROM access, control codes)
                /\/\/.*/,                 // single-line comments
                /\/\*[\s\S]*?\*\//,       // multi-line comments
            ];

            requiredElements.forEach((element) => {
                if (typeof element === 'string') {
                    expect(allContent).toContain(element);
                } else {
                    expect(element.test(allContent)).toBe(true);
                }
            });
        });
    });
});
