import config from 'eslint-config-upleveled';

const eslintConfig = [
  ...config,
  {
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];

export default eslintConfig;
