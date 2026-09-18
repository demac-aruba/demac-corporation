export type LocalProjectsBackup = {
  body: {
    format: 'demac-projects-local-backup';
    version: 1;
    capturedAt: string;
    origin: string;
    entries: Array<{ key: string; raw: string | null }>;
  };
  integrity: { algorithm: 'SHA-256'; digest: string };
};
export type BackupInspection = {
  capturedAt: string;
  origin: string;
  projectCount: number | null;
  templateCount: number | null;
  projects: unknown[] | null;
  issues: Array<{ code: string; key?: string; projectId?: string }>;
  migrationAllowed: false;
};
export const STORAGE_KEYS: readonly string[];
export const MAX_BACKUP_BYTES: number;
export function captureLocalBackup(storage: Pick<Storage, 'getItem'>, context: { capturedAt: string; origin: string }): Promise<LocalProjectsBackup>;
export function verifyLocalBackup(serialized: string): Promise<LocalProjectsBackup>;
/** Inspect only after verifyLocalBackup. An intact backup may contain malformed legacy data. */
export function inspectLocalBackup(backup: LocalProjectsBackup): BackupInspection;
