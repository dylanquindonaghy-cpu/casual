import { testUrls } from "./test-db";

// Runs before every test file: point the app's own configuration at the test database, so code
// under test (withFirm, the directory, jobs) can never reach the dev database.
const urls = testUrls();
process.env.DATABASE_URL = urls.app;
process.env.DATABASE_JOBS_URL = urls.jobs;
process.env.DATABASE_ADMIN_URL = urls.admin;
// Fixed, so tests don't depend on each developer's .env.
process.env.APP_BASE_DOMAIN = "localhost:3000";
process.env.SESSION_SECRET = "test-only-secret-not-for-any-real-use-0123";
