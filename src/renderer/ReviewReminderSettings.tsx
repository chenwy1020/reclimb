import { useEffect, useState } from 'react';
import type { ReviewReminderConfig } from '../shared/review-reminders';
import { Button } from './ui';

export default function ReviewReminderSettings({ busy }: { busy: boolean }) {
  const [config, setConfig] = useState<ReviewReminderConfig>({ enabled: false, time: '19:00' });
  const [loaded, setLoaded] = useState(false),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void window.learning
      .request<ReviewReminderConfig>('reminder.get')
      .then((value) => {
        if (active) {
          setConfig(value);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setMessage('提醒设置暂时未读到，请重新打开设置。');
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="review-reminder-settings" aria-label="本机回访提醒">
      <h3>回访提醒</h3>
      <p>重登运行时，在设定时间提醒今天到期的回访。关闭应用后不会提醒。</p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={!loaded || saving || busy}
          onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
        />
        开启本机提醒
      </label>
      <label>
        提醒时间{' '}
        <input
          type="time"
          aria-label="回访提醒时间"
          value={config.time}
          disabled={!loaded || saving || busy}
          onChange={(event) => setConfig({ ...config, time: event.target.value })}
        />
      </label>
      <Button
        disabled={!loaded || saving || busy || !config.time}
        onClick={async () => {
          setSaving(true);
          setMessage('');
          try {
            setConfig(
              await window.learning.request<ReviewReminderConfig>('reminder.configure', config),
            );
            setMessage('提醒设置已保存在本机。');
          } catch {
            setMessage('提醒设置未保存，请重试。');
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? '正在保存…' : '保存提醒设置'}
      </Button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
