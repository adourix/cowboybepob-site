import { syncAllEndpoints, closeEndpointSyncPool } from '../src/endpointSync.js';

syncAllEndpoints()
  .catch(error => {
    console.error('[endpoint-sync] fatal', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeEndpointSyncPool();
  });
