import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/integration/resource-production-copy.test.ts'],fileParallelism:false,testTimeout:120000,hookTimeout:30000}});
