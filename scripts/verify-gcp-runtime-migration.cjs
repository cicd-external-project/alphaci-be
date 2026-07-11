require('ts-node/register');

const { main } = require('../src/scripts/gcp-runtime-migration-verifier');

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
