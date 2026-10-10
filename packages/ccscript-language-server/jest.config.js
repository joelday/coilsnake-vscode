/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/src/**/*.test.ts'],
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, strict: true } }],
    },
    // Test against the core sources, so they don't need building first
    moduleNameMapper: {
        '^ccscript-core$': '<rootDir>/../ccscript-core/index.ts',
    },
    moduleFileExtensions: ['ts', 'js', 'json'],
    testTimeout: 20000,
};
