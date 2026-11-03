// Allure 3 config for the CI test report: one self-contained index.html (allure-report/).
// The allure2-style report is used because it is the one that honours ALLURE_NO_ANALYTICS=true
// (the other report styles always add a Google Analytics tag).
export default {
  name: 'Zcreenshot tests',
  output: './allure-report',
  plugins: {
    allure2: {
      options: { reportName: 'Zcreenshot tests', singleFile: true, reportLanguage: 'en' },
    },
  },
};
