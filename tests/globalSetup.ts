import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

let mongod: MongoMemoryServer | undefined;

export default async function setup(project: TestProject) {
  // Pin MongoDB 7.x — this host (macOS 12) cannot run the default 8.x binary (exit 48).
  mongod = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
    instance: { launchTimeout: 120_000 },
  });
  project.provide('mongoUri', mongod.getUri());
  return async () => {
    await mongod?.stop();
  };
}
