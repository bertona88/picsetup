import { defineConfig } from 'vitest/config';
export default defineConfig({base:'./', test:{include:['tests/**/*.test.ts']}, server:{host:'0.0.0.0',port:4175}, preview:{host:'0.0.0.0',port:4175}});
