import prepareTestDatabase from '../api/src/test/global-setup';

// Brings the test project up to the latest migration and installs pg-boss's schema, the same step as before the
// integration tests. Run it once before the first end-to-end run on a fresh test project (CI runs it every time).
await prepareTestDatabase();
