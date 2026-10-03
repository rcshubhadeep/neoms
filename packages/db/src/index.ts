import pg from 'pg';
import { PgBoss } from 'pg-boss';
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  connectionTimeoutMillis: 5000,
  options: '-c search_path=app,public -c statement_timeout=15000',
});
export type Tx = pg.PoolClient;
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('begin');
    const result = await fn(tx);
    await tx.query('commit');
    return result;
  } catch (error) {
    await tx.query('rollback');
    throw error;
  } finally {
    tx.release();
  }
}
export const SUMMARY_QUEUE = process.env.SUMMARY_QUEUE || 'summary';
export const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
boss.on('error', (error) => console.error('Job queue error:', error.message));
export async function startQueue() {
  await boss.start();
  await boss.createQueue(SUMMARY_QUEUE);
}
export async function enqueueSummary(tx: Tx, runId: string) {
  await boss.send(
    SUMMARY_QUEUE,
    { runId },
    {
      db: { executeSql: (sql, values) => tx.query(sql, values) },
      singletonKey: runId,
      retryLimit: 2,
      retryDelay: 2,
      expireInSeconds: 120,
    },
  );
}
