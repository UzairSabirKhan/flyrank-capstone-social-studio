import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'coverage'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/*', '!**/adapters/SocialPublisher'],
              message: 'Business logic may only depend on the SocialPublisher interface.',
            },
          ],
        },
      ],
    },
  },
);
