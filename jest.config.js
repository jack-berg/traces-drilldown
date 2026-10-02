// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

// Add additional ES modules that need to be transformed
const additionalESModules = [
  ...grafanaESModules,
  'marked',
  'react-calendar',
  'get-user-locale',
  'memoize',
  'mimic-function',
  '@wojtekmaj/date-utils',
];

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...require('./.config/jest.config'),
  // Equivalent to jest-environment-jsdom; this form is recognized by Knip's Jest plugin
  testEnvironment: 'jsdom',
  // Override transformIgnorePatterns to include additional ES modules
  transformIgnorePatterns: [nodeModulesToTransform(additionalESModules)],
  moduleNameMapper: {
    '^react(/.*)?$': '<rootDir>/node_modules/react$1',
    '^react-dom(/.*)?$': '<rootDir>/node_modules/react-dom$1',
    '^@grafana/(data|runtime|ui|schema)$': '<rootDir>/node_modules/@grafana/$1',
    '^@emotion/react$': '<rootDir>/node_modules/@emotion/react',
    '\\.(css|scss|sass)$': 'identity-obj-proxy',
    'react-inlinesvg': '<rootDir>/.config/jest/mocks/react-inlinesvg.tsx',
    '\\.(svg|png|jpg|jpeg|gif)$': '<rootDir>/.config/jest/mocks/fileMock.js', // Mock static file imports
  },
};
