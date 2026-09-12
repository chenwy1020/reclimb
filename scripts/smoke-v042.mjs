process.env.RECLIMB_TEST_PROJECT_TRASH='1';
process.env.RECLIMB_TEST_MODEL_PROFILES='1';
process.env.RECLIMB_TEST_REPORT_NAME='desktop-verification-v042.json';
await import('./smoke-v04.mjs');
