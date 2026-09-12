import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from 'sql.js';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import {DEFAULT_MODEL_PROFILE_ID,type Collection,type EntityMap,type Fragment,type ModelProfile,type Settings,type WorkspaceSnapshot} from '../shared/types';

export const COLLECTIONS: Collection[] = ['projects', 'capabilities', 'materials', 'fragments', 'sessions', 'attempts', 'evidence', 'reviews', 'usage', 'sourceTranscriptions','teachingVersions','taskReviews','disputes','corrections','answerExposures','routeVersions','learningUnits','learningPositions','teachingObservations','understandingDrafts','readingLayouts'];
const COLLECTION_SET = new Set<string>(COLLECTIONS);
const APPEND_ONLY=new Set<Collection>(['teachingVersions','taskReviews','corrections','answerExposures']);
const DEFAULT_SETTINGS: Settings = {
  providerName: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', maxOutputTokens:12000,
  monthlyBudgetCny: 0, inputPriceCnyPerMillion: 10, outputPriceCnyPerMillion: 30,
  priceUpdatedAt: '2026-09-07（保守估算，非官方报价）', hasApiKey: false,
  personalGoal: '', studyMinutes: 30, confirmedPreferences: '',
  modelProfiles:[{id:DEFAULT_MODEL_PROFILE_ID,name:'默认模型',providerName:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-v4-pro',maxOutputTokens:12000,inputPriceCnyPerMillion:10,outputPriceCnyPerMillion:30,priceUpdatedAt:'2026-09-07（保守估算，非官方报价）',enabled:true}],activeModelProfileId:DEFAULT_MODEL_PROFILE_ID,
};
const RENAME_RETRY_DELAYS_MS = [15, 30, 60, 120] as const;
const renameWaiter = new Int32Array(new SharedArrayBuffer(4));
function replaceDatabaseFile(temporary: string, destination: string): void {
  const deadline = performance.now() + 400;
  for (let retry = 0; ; retry++) {
    try { renameSync(temporary, destination); return; }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const delay = RENAME_RETRY_DELAYS_MS[retry];
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(String(code)) || delay === undefined || performance.now() + delay >= deadline) throw error;
      // Windows scanners can briefly hold a file. Wait at most 225 ms in total;
      // never remove the old database to work around a failed atomic replacement.
      Atomics.wait(renameWaiter, 0, 0, delay);
    }
  }
}
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
function terms(text: string): string[] {
  const found = new Set<string>();
  for (const part of segmenter.segment(text.normalize('NFKC').toLocaleLowerCase())) {
    if (!part.isWordLike) continue;
    found.add(part.segment);
    const chars = Array.from(part.segment);
    if (/^[\p{Script=Han}]+$/u.test(part.segment)) {
      for (let index = 0; index + 1 < chars.length; index++) found.add(chars[index] + chars[index + 1]);
    }
  }
  return [...found];
}
const PROFILE_ID=/^[a-zA-Z0-9_-]{1,120}$/;
const ACTIVE_PROFILE_FIELDS=['providerName','baseUrl','model','maxOutputTokens','inputPriceCnyPerMillion','outputPriceCnyPerMillion','priceUpdatedAt'] as const;
function cleanProfile(value:unknown):ModelProfile|undefined{
  if(!value||typeof value!=='object')return;
  const raw=value as Record<string,unknown>,id=typeof raw.id==='string'?raw.id.trim():'',name=typeof raw.name==='string'?raw.name.trim().slice(0,120):'',providerName=typeof raw.providerName==='string'?raw.providerName.trim().slice(0,200):'',baseUrl=typeof raw.baseUrl==='string'?raw.baseUrl.trim().slice(0,2000):'',model=typeof raw.model==='string'?raw.model.trim().slice(0,150):'';
  if(!PROFILE_ID.test(id)||!name||!providerName||!baseUrl||!model)return;
  const inputPrice=typeof raw.inputPriceCnyPerMillion==='number'&&Number.isFinite(raw.inputPriceCnyPerMillion)&&raw.inputPriceCnyPerMillion>=.01?raw.inputPriceCnyPerMillion:10;
  const outputPrice=typeof raw.outputPriceCnyPerMillion==='number'&&Number.isFinite(raw.outputPriceCnyPerMillion)&&raw.outputPriceCnyPerMillion>=.01?raw.outputPriceCnyPerMillion:30;
  const maxOutputTokens=typeof raw.maxOutputTokens==='number'&&Number.isInteger(raw.maxOutputTokens)&&raw.maxOutputTokens>=512&&raw.maxOutputTokens<=131072?raw.maxOutputTokens:12000;
  return{id,name,providerName,baseUrl,model,maxOutputTokens,inputPriceCnyPerMillion:inputPrice,outputPriceCnyPerMillion:outputPrice,priceUpdatedAt:typeof raw.priceUpdatedAt==='string'?raw.priceUpdatedAt.slice(0,2000):'待核对',enabled:raw.enabled===true};
}
export function normalizeSettings(value: Partial<Settings>): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key === 'hasApiKey') continue;
    const proposed = value[key];
    if (typeof proposed !== typeof DEFAULT_SETTINGS[key]) continue;
    if (typeof proposed === 'number' && (!Number.isFinite(proposed) || proposed < 0)) continue;
    (settings as unknown as Record<string, unknown>)[key] = proposed;
  }
  const v=value.vision;
  if(v&&typeof v==='object')settings.vision={enabled:v.enabled===true,providerName:typeof v.providerName==='string'?v.providerName.slice(0,200):'',baseUrl:typeof v.baseUrl==='string'?v.baseUrl.slice(0,2000):'',model:typeof v.model==='string'?v.model.slice(0,150):'',inputPriceCnyPerMillion:Number.isFinite(v.inputPriceCnyPerMillion)&&v.inputPriceCnyPerMillion>=.01?v.inputPriceCnyPerMillion:10,outputPriceCnyPerMillion:Number.isFinite(v.outputPriceCnyPerMillion)&&v.outputPriceCnyPerMillion>=.01?v.outputPriceCnyPerMillion:30,priceUpdatedAt:typeof v.priceUpdatedAt==='string'?v.priceUpdatedAt.slice(0,2000):'待核对',hasApiKey:false};
  settings.providerName=typeof settings.providerName==='string'&&settings.providerName.trim()?settings.providerName.trim().slice(0,200):DEFAULT_SETTINGS.providerName;
  settings.baseUrl=typeof settings.baseUrl==='string'&&settings.baseUrl.trim()?settings.baseUrl.trim().slice(0,2000):DEFAULT_SETTINGS.baseUrl;
  settings.model=typeof settings.model==='string'&&settings.model.trim()?settings.model.trim().slice(0,150):DEFAULT_SETTINGS.model;
  settings.maxOutputTokens=typeof settings.maxOutputTokens==='number'&&Number.isInteger(settings.maxOutputTokens)&&settings.maxOutputTokens>=512&&settings.maxOutputTokens<=131072?settings.maxOutputTokens:12000;
  const seen=new Set<string>(),profiles=(Array.isArray(value.modelProfiles)?value.modelProfiles.map(cleanProfile).filter((profile):profile is ModelProfile=>!!profile&&(!seen.has(profile.id)&&!!seen.add(profile.id))):[]);
  if(!profiles.length)profiles.push({id:DEFAULT_MODEL_PROFILE_ID,name:'默认模型',providerName:settings.providerName,baseUrl:settings.baseUrl,model:settings.model,maxOutputTokens:settings.maxOutputTokens,inputPriceCnyPerMillion:settings.inputPriceCnyPerMillion,outputPriceCnyPerMillion:settings.outputPriceCnyPerMillion,priceUpdatedAt:settings.priceUpdatedAt,enabled:true});
  let active=profiles.find(profile=>profile.id===value.activeModelProfileId&&profile.enabled)??profiles.find(profile=>profile.enabled);
  if(!active){profiles[0]={...profiles[0],enabled:true};active=profiles[0];}
  settings.modelProfiles=profiles;settings.activeModelProfileId=active.id;settings.hasApiKey=false;
  for(const field of ACTIVE_PROFILE_FIELDS)(settings as unknown as Record<string,unknown>)[field]=active[field];
  return settings;
}
export function activeModelProfile(settings:Settings):ModelProfile{
  const normalized=normalizeSettings(settings);return normalized.modelProfiles!.find(profile=>profile.id===normalized.activeModelProfileId)!;
}

/** A local SQLite store. Each outer transaction is one atomic disk replacement. */
export class LearningStore {
  private depth = 0;
  private dirty = false;
  private closed = false;
  private readonly filePath: string;
  private constructor(private db: Database, private readonly sql: SqlJsStatic, readonly dataDirectory: string) {
    this.filePath = join(dataDirectory, 'learning.sqlite');
  }

  static async open(directory: string, wasmPath?: string): Promise<LearningStore> {
    const dataDirectory = resolve(directory);
    const filePath = join(dataDirectory, 'learning.sqlite');
    const existing = existsSync(filePath) ? readFileSync(filePath) : undefined;
    if (existing && (existing.length < 16 || existing.subarray(0, 16).toString() !== 'SQLite format 3\0')) {
      throw new Error('学习数据库损坏或不是 SQLite 文件；原文件已保留，请从备份恢复。');
    }
    const sql = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined);
    let db: Database | undefined;
    try {
      db = new sql.Database(existing);
      const check = db.exec('PRAGMA quick_check');
      if (check[0]?.values.some(row => row[0] !== 'ok')) throw new Error('学习数据库完整性检查失败；原文件已保留。');
      const version = Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0] ?? 0);
      if (version > 7) throw new Error('此学习数据库由更新版本创建，请先升级应用。');
      mkdirSync(dataDirectory, { recursive: true });
      if(existing && version<7){
        const backupDirectory=join(dataDirectory,'upgrade-backups');mkdirSync(backupDirectory,{recursive:true});
        const label=version<5?'pre-0.4':version<6?'pre-0.4.1':'pre-0.4.2';
        writeFileSync(join(backupDirectory,label+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.sqlite'),existing,{flag:'wx',mode:0o600});
      }
      const store = new LearningStore(db, sql, dataDirectory);
      store.transaction(() => {
        for (const collection of COLLECTIONS) {
          db!.run(`CREATE TABLE IF NOT EXISTS ${collection} (id TEXT PRIMARY KEY NOT NULL, project_id TEXT, entity TEXT NOT NULL)`);
          db!.run(`CREATE INDEX IF NOT EXISTS ${collection}_project ON ${collection} (project_id)`);
        }
        db!.run('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), entity TEXT NOT NULL)');
        db!.run('CREATE TABLE IF NOT EXISTS fragment_terms (fragment_id TEXT NOT NULL, project_id TEXT NOT NULL, term TEXT NOT NULL, PRIMARY KEY(fragment_id, term))');
        db!.run('CREATE INDEX IF NOT EXISTS fragment_terms_lookup ON fragment_terms(project_id, term)');
        db!.run('PRAGMA user_version=7');
        // Rebuild only when adopting an older store that has not yet had a term index.
        if (store.rows('SELECT 1 FROM fragment_terms LIMIT 1').length === 0) {
          for (const fragment of store.list('fragments')) store.indexFragment(fragment);
        }
        const settings = store.getSettings();
        db!.run('INSERT OR REPLACE INTO settings(id, entity) VALUES (1, ?)', [JSON.stringify(settings)]);
        store.dirty = true;
      });
      return store;
    } catch (error) {
      db?.close();
      throw error;
    }
  }

  private ensureOpen(): void { if (this.closed) throw new Error('学习数据库已关闭。'); }
  private collection(collection: Collection): Collection {
    this.ensureOpen();
    if (!COLLECTION_SET.has(collection)) throw new Error('不支持的数据集合。');
    return collection;
  }
  private rows(query: string, parameters: SqlValue[] = []): Record<string, SqlValue>[] {
    this.ensureOpen();
    const statement = this.db.prepare(query);
    try {
      statement.bind(parameters);
      const result: Record<string, SqlValue>[] = [];
      while (statement.step()) result.push(statement.getAsObject());
      return result;
    } finally { statement.free(); }
  }
  get<K extends Collection>(collection: K, id: string): EntityMap[K] | undefined {
    const row = this.rows(`SELECT entity FROM ${this.collection(collection)} WHERE id = ?`, [id])[0];
    return row ? JSON.parse(String(row.entity)) as EntityMap[K] : undefined;
  }
  list<K extends Collection>(collection: K, projectId?: string): EntityMap[K][] {
    const table = this.collection(collection);
    const rows = projectId === undefined
      ? this.rows(`SELECT entity FROM ${table} ORDER BY rowid`)
      : this.rows(`SELECT entity FROM ${table} WHERE project_id = ? ORDER BY rowid`, [projectId]);
    return rows.map(row => JSON.parse(String(row.entity)) as EntityMap[K]);
  }
  put<K extends Collection>(collection: K, entity: EntityMap[K]): void {
    const table = this.collection(collection);
    if (!entity || typeof entity.id !== 'string' || !entity.id.trim()) throw new Error('数据缺少有效标识。');
    if(APPEND_ONLY.has(collection)){const existing=this.get(collection,entity.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(entity))throw new Error('已保存的教学版本、核验及纠正记录不可覆盖，请追加新记录。');}
    this.transaction(() => {
      this.db.run(`INSERT INTO ${table}(id, project_id, entity) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, entity=excluded.entity`, [entity.id, 'projectId' in entity ? entity.projectId : null, JSON.stringify(entity)]);
      if (collection === 'fragments') this.indexFragment(entity as Fragment);
      this.dirty = true;
    });
  }
  private indexFragment(fragment: Fragment): void {
    this.db.run('DELETE FROM fragment_terms WHERE fragment_id = ?', [fragment.id]);
    const statement = this.db.prepare('INSERT INTO fragment_terms(fragment_id, project_id, term) VALUES (?, ?, ?)');
    try { for (const term of terms(fragment.searchableText??fragment.text)) statement.run([fragment.id, fragment.projectId, term]); }
    finally { statement.free(); }
  }
  remove(collection: Collection, id: string): void {
    if(APPEND_ONLY.has(collection))throw new Error('教学核验与纠正历史不可删除，请追加说明。');
    const table = this.collection(collection);
    this.transaction(() => {
      this.db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
      if (collection === 'fragments') this.db.run('DELETE FROM fragment_terms WHERE fragment_id = ?', [id]);
      this.dirty = true;
    });
  }
  deleteProjectRecords(projectId:string):void{
    if(!projectId.trim())throw new Error('缺少有效的项目编号。');
    this.transaction(()=>{
      for(const collection of COLLECTIONS){
        if(collection==='projects')continue;
        this.db.run(`DELETE FROM ${this.collection(collection)} WHERE project_id = ?`,[projectId]);
      }
      this.db.run('DELETE FROM fragment_terms WHERE project_id = ?',[projectId]);
      this.db.run('DELETE FROM projects WHERE id = ?',[projectId]);
      this.dirty=true;
    });
  }
  getSettings(): Settings {
    const row = this.rows('SELECT entity FROM settings WHERE id=1')[0];
    return normalizeSettings(row ? JSON.parse(String(row.entity)) as Partial<Settings> : {});
  }
  updateSettings(partial: Partial<Settings>): void {
    const current=this.getSettings(),hasProfiles=Object.prototype.hasOwnProperty.call(partial,'modelProfiles');let merged:Partial<Settings>={...current,...partial};
    if(!hasProfiles&&current.modelProfiles&&ACTIVE_PROFILE_FIELDS.some(field=>Object.prototype.hasOwnProperty.call(partial,field))){
      merged={...merged,modelProfiles:current.modelProfiles.map(profile=>profile.id===current.activeModelProfileId?{...profile,...Object.fromEntries(ACTIVE_PROFILE_FIELDS.filter(field=>Object.prototype.hasOwnProperty.call(partial,field)).map(field=>[field,partial[field]]))}:profile)};
    }
    const settings = normalizeSettings(merged);
    this.transaction(() => {
      this.db.run('INSERT OR REPLACE INTO settings(id, entity) VALUES (1, ?)', [JSON.stringify(settings)]);
      this.dirty = true;
    });
  }
  snapshot(): WorkspaceSnapshot {
    return { projects: this.list('projects'), capabilities: this.list('capabilities'), materials: this.list('materials'), fragments: this.list('fragments'), sessions: this.list('sessions'), attempts: this.list('attempts'), evidence: this.list('evidence'), reviews: this.list('reviews'), usage: this.list('usage'), sourceTranscriptions:this.list('sourceTranscriptions'),teachingVersions:this.list('teachingVersions'),taskReviews:this.list('taskReviews'),disputes:this.list('disputes'),corrections:this.list('corrections'),answerExposures:this.list('answerExposures'),routeVersions:this.list('routeVersions'),learningUnits:this.list('learningUnits'),learningPositions:this.list('learningPositions'),teachingObservations:this.list('teachingObservations'),understandingDrafts:this.list('understandingDrafts'),readingLayouts:this.list('readingLayouts'), settings: this.getSettings(), dataDirectory: this.dataDirectory };
  }
  transaction<T>(fn: () => T): T {
    this.ensureOpen();
    const outer = this.depth === 0;
    const prior = outer ? this.db.export() : undefined;
    const wasDirty = this.dirty;
    const savepoint = `learning_${this.depth}`;
    this.db.run(outer ? 'BEGIN TRANSACTION' : `SAVEPOINT ${savepoint}`);
    this.depth++;
    let committed = false;
    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('数据库事务必须是同步操作。');
      this.db.run(outer ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
      committed = true;
      this.depth--;
      if (outer) this.flush();
      return result;
    } catch (error) {
      if (!committed) this.depth--;
      if (outer) {
        // Restore memory too if atomic persistence failed after SQL COMMIT.
        this.db.close();
        this.db = new this.sql.Database(prior!);
      } else {
        this.db.run(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.run(`RELEASE SAVEPOINT ${savepoint}`);
      }
      this.dirty = wasDirty;
      throw error;
    }
  }
  flush(): void {
    this.ensureOpen();
    if (this.depth > 0 || !this.dirty) return;
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, this.db.export());
      fsyncSync(descriptor);
      closeSync(descriptor); descriptor = undefined;
      replaceDatabaseFile(temporary, this.filePath);
      this.dirty = false;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporary)) { try { unlinkSync(temporary); } catch { /* Preserve the original write error. */ } }
    }
  }
  close(): void {
    if (this.closed) return;
    if (this.depth > 0) throw new Error('不能在事务进行中关闭数据库。');
    this.flush(); this.db.close(); this.closed = true;
  }
  searchFragments(projectId: string, query: string, limit = 8): Fragment[] {
    const queryTerms = terms(query.slice(0, 2000)).slice(0, 64);
    if (queryTerms.length === 0) return [];
    const count = Number.isFinite(limit) ? Math.max(0, Math.min(100, Math.floor(limit))) : 8;
    if (count === 0) return [];
    return this.rows(`SELECT f.entity FROM fragments f JOIN fragment_terms t ON t.fragment_id=f.id WHERE f.project_id=? AND t.project_id=? AND t.term IN (${queryTerms.map(() => '?').join(',')}) GROUP BY f.id ORDER BY COUNT(DISTINCT t.term) DESC, f.rowid LIMIT ?`, [projectId, projectId, ...queryTerms, count]).map(row => JSON.parse(String(row.entity)) as Fragment);
  }
}
