import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ReviewReminderConfig } from '../shared/review-reminders';

const configurationSchema = z
  .object({
    enabled: z.boolean(),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();
const stateSchema = configurationSchema
  .extend({
    lastNotifiedDay: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

/** Device preferences stay outside portable study backups. No background service is installed. */
export class LocalReviewReminder {
  private state: z.infer<typeof stateSchema> = { enabled: false, time: '19:00' };
  constructor(private readonly path: string) {
    if (!existsSync(path)) return;
    try {
      const text = readFileSync(path, 'utf8');
      if (text.length <= 4096) this.state = stateSchema.parse(JSON.parse(text));
    } catch {
      // A damaged device preference must not prevent access to the learning archive.
    }
  }
  configuration(): ReviewReminderConfig {
    return { enabled: this.state.enabled, time: this.state.time };
  }
  private save(next: z.infer<typeof stateSchema>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = this.path + '.tmp-' + randomUUID();
    writeFileSync(temporary, JSON.stringify(next), { encoding: 'utf8', flag: 'wx' });
    try {
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
    this.state = next;
  }
  configure(value: unknown): ReviewReminderConfig {
    this.save({ ...this.state, ...configurationSchema.parse(value) });
    return this.configuration();
  }
  tick(dueCount: number, now: Date, notify: (count: number) => boolean): boolean {
    if (
      !this.state.enabled ||
      !Number.isInteger(dueCount) ||
      dueCount < 1 ||
      !Number.isFinite(now.getTime())
    )
      return false;
    const day = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const minute = now.getHours() * 60 + now.getMinutes();
    const [hour, minutes] = this.state.time.split(':').map(Number);
    if (this.state.lastNotifiedDay === day || minute < hour * 60 + minutes) return false;
    if (!notify(dueCount)) return false;
    // A successful notification must not repeat every minute if the preference disk is full.
    this.state = { ...this.state, lastNotifiedDay: day };
    this.save({ ...this.state, lastNotifiedDay: day });
    return true;
  }
}
