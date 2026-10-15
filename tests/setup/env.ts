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
// Alerts to the founder go nowhere in tests (tests that check them pass their own transport).
process.env.ALERTS_TRANSPORT = "none";
// Never a real email server, whatever .env says (the settings also refuse smtp under
// NODE_ENV=test; scripts/invariants.sh checks these lines stay).
process.env.EMAIL_TRANSPORT = "console";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
// Never the Anthropic API, whatever .env says (the settings also refuse anthropic under
// NODE_ENV=test; scripts/invariants.sh checks these lines stay).
process.env.AI_TRANSPORT = "none";
process.env.ANTHROPIC_API_KEY = "";
// Never postcodes.io or TravelTime, whatever .env says (the settings also refuse traveltime under
// NODE_ENV=test).
process.env.TRAVEL_PROVIDER = "fake";
process.env.TRAVELTIME_APP_ID = "";
process.env.TRAVELTIME_API_KEY = "";
// A made-up planner integration secret (12J.1), never .env's own: the planner API answers with it
// set (a test of the unset case passes its own settings). scripts/invariants.sh checks this line
// stays.
process.env.INTEGRATIONS_SECRET = "test-only-integrations-secret-not-for-any-real-use";
// Never a real webhook address (12J.2), whatever .env says: the console transport (the worker's
// settings also refuse https under NODE_ENV=test). Tests of the sender pass their own fake.
process.env.WEBHOOK_TRANSPORT = "console";
