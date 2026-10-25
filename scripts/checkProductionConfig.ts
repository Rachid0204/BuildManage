import { validateProductionEnvironment } from '../server/productionConfig';
try {
 const env = validateProductionEnvironment({ ...process.env, NODE_ENV: 'production' })!;
 console.log(`Production configuration valid: ${env.GOOGLE_CLOUD_PROJECT}, ${env.FIRESTORE_DATABASE_ID}, ${env.SYNDIK_STATE_BACKEND}`);
} catch (error) {
 console.error(error instanceof Error ? error.message : 'Invalid production configuration');
 process.exitCode = 1;
}
