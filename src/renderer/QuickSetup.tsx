import { useState } from 'react';
import { Check, KeyRound } from 'lucide-react';
import type { ModelProfile, WorkspaceSnapshot } from '../shared/types';
import { DEFAULT_MODEL_OUTPUT_TOKENS } from '../shared/model-limits';
import { Button, type Run } from './ui';
import SettingsCard from './SettingsCard';

export interface QuickConnection {
  baseUrl: string;
  model: string;
  inputPriceCnyPerMillion: number;
  outputPriceCnyPerMillion: number;
  priceUpdatedAt: string;
}

/** Always create a separate profile; a quick connection never edits an existing credential. */
export function quickConnectionProfile(
  value: QuickConnection,
  profiles: readonly ModelProfile[],
): Omit<ModelProfile, 'id' | 'hasApiKey'> {
  const url = new URL(value.baseUrl.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('请使用服务商提供的 HTTPS 接口地址，地址中不要附带密钥或参数。');
  const model = value.model.trim();
  if (!model) throw new Error('请填写服务商提供的模型名称。');
  const base = `${model} · ${url.hostname}`.slice(0, 65);
  const names = new Set(profiles.map((profile) => profile.name.trim().toLocaleLowerCase()));
  let name = base;
  for (let suffix = 2; names.has(name.toLocaleLowerCase()); suffix++) name = `${base} ${suffix}`;
  return {
    ...value,
    name,
    providerName: url.hostname,
    baseUrl: value.baseUrl.trim(),
    model,
    maxOutputTokens: DEFAULT_MODEL_OUTPUT_TOKENS,
    enabled: true,
  };
}

export default function QuickSetup({
  snapshot,
  busy,
  run,
  monthlyBudgetCny,
  onBudgetChange,
}: {
  snapshot: WorkspaceSnapshot;
  busy: boolean;
  run: Run;
  monthlyBudgetCny: number;
  onBudgetChange: (value: number) => void;
}) {
  const [form, setForm] = useState<QuickConnection>({
    baseUrl: '',
    model: '',
    inputPriceCnyPerMillion: 10,
    outputPriceCnyPerMillion: 30,
    priceUpdatedAt: '2026-10-15（本机预算占位估算，未核对服务商价格）',
  });
  const [apiKey, setApiKey] = useState('');
  const [savedId, setSavedId] = useState('');
  const [connected, setConnected] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const locked = busy || working;
  const hasConnection = !!snapshot.settings.modelProfiles?.some((profile) => profile.hasApiKey);
  function change<K extends keyof QuickConnection>(key: K, value: QuickConnection[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function connect() {
    if (locked) return;
    setWorking(true);
    setError('');
    try {
      let id = savedId;
      const profile = id
        ? undefined
        : quickConnectionProfile(form, snapshot.settings.modelProfiles ?? []);
      if (monthlyBudgetCny !== snapshot.settings.monthlyBudgetCny) {
        const updated = await run('settings.save', { settings: { monthlyBudgetCny } });
        if (!updated) return;
      }
      if (!id && profile) {
        const next = await run('settings.modelProfile.save', { profile, apiKey: apiKey.trim() });
        if (!next) return;
        id = next.settings.modelProfiles?.find((item) => item.name === profile.name)?.id ?? '';
        if (!id) throw new Error('配置已保存，请在下方模型配置中测试连接。');
        setSavedId(id);
        setApiKey('');
      }
      const tested = await run('settings.modelProfile.test', { id });
      if (!tested) return;
      const activated = await run(
        'settings.modelProfile.activate',
        { id },
        '连接成功，之后的学习使用这项配置。',
      );
      if (activated) setConnected(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '连接未完成，请检查填写内容。');
    } finally {
      setWorking(false);
    }
  }
  return (
    <SettingsCard
      title="快速连接 AI"
      description="使用自己的服务商账号，电脑直接连接，无需自建服务器。"
      icon={<KeyRound size={21} />}
      defaultOpen={!hasConnection}
      className="quick-setup-card"
    >
      {savedId ? (
        <div className="quick-setup-result" role="status">
          <strong>
            {connected ? '连接成功，可以开始学习。' : '配置已保存，等待连接测试通过。'}
          </strong>
          {!connected && <p>填写有误时，可在下方“模型配置”编辑这项，再测试一次。</p>}
        </div>
      ) : (
        <>
          <div className="form-grid">
            <label className="span-2">
              服务商的兼容接口地址
              <input
                value={form.baseUrl}
                onChange={(e) => change('baseUrl', e.target.value)}
                placeholder="https://…/v1"
                disabled={locked}
              />
              <small>从服务商文档复制 OpenAI 兼容接口地址。</small>
            </label>
            <label>
              模型名称
              <input
                value={form.model}
                onChange={(e) => change('model', e.target.value)}
                placeholder="复制服务商提供的模型名称"
                disabled={locked}
              />
            </label>
            <label>
              API 密钥
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={locked}
                placeholder="粘贴自己的密钥"
              />
            </label>
          </div>
          <details className="quick-setup-advanced">
            <summary>费用估算与高级配置</summary>
            <p className="quiet-note">下列价格仅为本机预算占位估算，请按服务商账单修改。</p>
            <div className="form-grid">
              <label>
                输入估算（元 / 百万 token）
                <input
                  type="number"
                  min="0.01"
                  max="100000"
                  step="0.01"
                  value={form.inputPriceCnyPerMillion}
                  onChange={(e) => change('inputPriceCnyPerMillion', Number(e.target.value))}
                  disabled={locked}
                />
              </label>
              <label>
                输出估算（元 / 百万 token）
                <input
                  type="number"
                  min="0.01"
                  max="100000"
                  step="0.01"
                  value={form.outputPriceCnyPerMillion}
                  onChange={(e) => change('outputPriceCnyPerMillion', Number(e.target.value))}
                  disabled={locked}
                />
              </label>
              <label className="span-2">
                价格依据与日期
                <input
                  value={form.priceUpdatedAt}
                  onChange={(e) => change('priceUpdatedAt', e.target.value)}
                  disabled={locked}
                />
              </label>
            </div>
            <p className="quiet-note">配置名称、回复上限等可在保存后的“模型配置”中调整。</p>
          </details>
          <p className="price-source">
            当前按输入 ¥{form.inputPriceCnyPerMillion}、输出 ¥{form.outputPriceCnyPerMillion} / 百万
            token 估算。{form.priceUpdatedAt}。
          </p>
        </>
      )}
      {!connected && (
        <>
          <label className="quick-setup-budget">
            本机每月预算（元）
            <input
              type="number"
              min="0.01"
              max="100000"
              step="1"
              value={monthlyBudgetCny || ''}
              onChange={(e) => onBudgetChange(Number(e.target.value))}
              placeholder="自行设定，例如 10"
              disabled={locked}
            />
          </label>
          <p className="quiet-note">测试会发送小额请求并记入本机用量；实际收费以服务商账单为准。</p>
          {error && (
            <p className="quick-setup-error" role="alert">
              {error}
            </p>
          )}
          <Button
            variant="primary"
            disabled={
              locked ||
              monthlyBudgetCny <= 0 ||
              (!savedId && (!form.baseUrl.trim() || !form.model.trim() || !apiKey.trim()))
            }
            onClick={() => void connect()}
          >
            <Check size={15} />
            {working ? '正在连接…' : savedId ? '重新测试并启用' : '保存并测试连接'}
          </Button>
        </>
      )}
    </SettingsCard>
  );
}
