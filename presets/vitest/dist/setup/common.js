// For every project: the schemas the DB helper made are dropped after each test and at file end.
import { afterAll, afterEach } from 'vitest';
import { dropFileSchemas, dropTestSchemas } from '../db.js';
afterEach(dropTestSchemas);
afterAll(async () => {
    await dropTestSchemas();
    await dropFileSchemas();
});
