/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/src/**/*.test.ts'],
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: {
            // node16 resolution reads packages' "exports" (vscode-languageserver 10 only has types
            // there) and still compiles to CommonJS for Jest
            module: 'node16',
            moduleResolution: 'node16',
            esModuleInterop: true,
            strict: true,
            types: ['jest', 'node'],
        } }],
    },
    // Test against the core sources, so they don't need building first
    moduleNameMapper: {
        '^ccscript-core$': '<rootDir>/../ccscript-core/index.ts',
    },
    moduleFileExtensions: ['ts', 'js', 'json'],
    testTimeout: 20000,
};
