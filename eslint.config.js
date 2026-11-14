import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'data/', 'docs/', '.superpowers/'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'discord.js', message: 'core must stay free of discord.js' },
            { name: 'better-sqlite3', message: 'core must stay free of better-sqlite3' },
            { name: 'node:http', message: 'core must stay free of node:http' },
          ],
          patterns: [{ group: ['../*'], message: 'core must not import from other src folders' }],
        },
      ],
    },
  },
  {
    // index.ts is the registration list, not a module; it imports every module.
    files: ['src/modules/*.ts'],
    ignores: ['src/modules/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['./*', '!./shared-options.js', '!./admin-parse.js'],
              message:
                'a module must not import another module; only shared-options.ts and admin-parse.ts are shared helpers',
            },
          ],
        },
      ],
    },
  },
);
