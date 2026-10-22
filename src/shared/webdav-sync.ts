/** Connection preferences are installation-local and never part of learning snapshots. */
export interface WebDavConfigureInput {
  endpoint: string;
  username: string;
  password?: string;
  vaultId?: string;
  deviceName?: string;
  allowInsecureHTTP?: boolean;
}
export interface SyncRemoteSnapshot {
  format: 'reclimb.webdav.snapshot';
  version: 1;
  vaultId: string;
  snapshotId: string;
  deviceId: string;
  deviceName: string;
  parentSnapshotId: string | null;
  createdAt: string;
  contentHash: string;
  sha256: string;
  bytes: number;
}
export type WebDavSyncState =
  | 'not_configured'
  | 'unchecked'
  | 'remote_empty'
  | 'up_to_date'
  | 'local_ahead'
  | 'remote_ahead'
  | 'conflict'
  | 'unlinked'
  | 'unsupported';
export interface WebDavSyncStatus {
  configured: boolean;
  busy: boolean;
  deviceId: string;
  deviceName: string;
  vaultId?: string;
  endpoint?: string;
  username?: string;
  hasPassword: boolean;
  allowInsecureHTTP: boolean;
  state: WebDavSyncState;
  message: string;
  checkedAt?: string;
  localContentHash?: string;
  baselineContentHash?: string;
  baselineSnapshotId?: string;
  remote?: SyncRemoteSnapshot;
  pendingUploadRequestId?: string;
  lastUploadedAt?: string;
}
export interface SyncBackupSummary {
  projects: number;
  sessions: number;
  materials: number;
  handwritings: number;
  createdAt?: string;
  [key: string]: unknown;
}
export interface WebDavSyncPreview {
  id: string;
  snapshot: SyncRemoteSnapshot;
  localContentHash: string;
  summary: SyncBackupSummary;
  requiresReplaceConfirmation: boolean;
  createdAt: string;
}
export interface WebDavUploadInput {
  requestId: string;
  expectedRemoteSnapshotId?: string | null;
}
export interface WebDavAdoptInput {
  previewId: string;
  expectedLocalContentHash: string;
  expectedRemoteSnapshotId: string;
  allowReplaceLocal?: boolean;
}
/** Workspace replacement committed even when a later local sync-status update failed. */
export interface WebDavAdoptResult extends WebDavSyncStatus {
  adopted: true;
  warning?: string;
}
