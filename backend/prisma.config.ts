import { defineConfig } from 'prisma/config';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://apm:apm@127.0.0.1:5432/apm';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
});
