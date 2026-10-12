import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        plugins: {
            '@stylistic': stylistic
        },
        rules: {
            '@stylistic/semi': 'error',
            '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
            '@typescript-eslint/naming-convention': [
                'warn',
                {
                    selector: 'enumMember',
                    format: ['PascalCase']
                }
            ],
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_'
                }
            ]
        }
    },
    {
        ignores: ['out/**', 'dist/**', 'node_modules/**', '**/*.js', '**/*.mjs']
    }
);
