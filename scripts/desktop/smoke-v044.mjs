process.env.RECLIMB_TEST_REPORT_NAME='desktop-verification-v044.json';
process.env.RECLIMB_TEST_ROUTE_REPAIR='1';
process.env.RECLIMB_TEST_OUTPUT_LIMIT='1';
process.env.RECLIMB_TEST_PROJECT_TRASH='1';
process.env.RECLIMB_TEST_MODEL_PROFILES='1';
await import('./smoke-v04.mjs');
