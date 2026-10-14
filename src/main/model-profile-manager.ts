import { randomUUID } from 'node:crypto';
import type { ModelProfile, Settings } from '../shared/types';
import { buildChatUrl } from './provider';
import { modelProfileInputSchema } from './settings-schema';
import { LearningStore } from './store';
import { CredentialsStore } from './credentials';
import { DEFAULT_MODEL_OUTPUT_TOKENS } from '../shared/model-limits';

export interface ModelCallContext {
  profile: ModelProfile;
  settings: Settings;
  key: string;
}

/** Keeps profile metadata, active selection and encrypted keys consistent. */
export class ModelProfileManager {
  constructor(
    private store: LearningStore,
    private credentials: CredentialsStore,
    private busy: () => boolean = () => false,
  ) {}

  private requireIdle(): void {
    if (this.busy()) throw new Error('上一项 AI 操作还在进行，请稍候再更改模型配置。');
  }
  private list(): ModelProfile[] {
    return this.store.getSettings().modelProfiles ?? [];
  }
  private require(id: string): ModelProfile {
    const profile = this.list().find((item) => item.id === id);
    if (!profile) throw new Error('模型配置不存在，请刷新后重试。');
    return profile;
  }

  save(value: unknown, apiKey?: string): string {
    this.requireIdle();
    const parsed = modelProfileInputSchema.parse(value),
      settings = this.store.getSettings(),
      profiles = this.list(),
      id = parsed.id ?? randomUUID(),
      existing = profiles.find((item) => item.id === id);
    if (parsed.id && !existing) throw new Error('要编辑的模型配置不存在，请刷新后重试。');
    buildChatUrl(parsed.baseUrl);
    const name = parsed.name.trim(),
      duplicate = profiles.find(
        (item) =>
          item.id !== id && item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
      );
    if (duplicate) throw new Error('模型配置名称不能重复，请换一个容易辨认的名称。');
    if (!parsed.enabled && settings.activeModelProfileId === id)
      throw new Error('当前模型配置不能停用，请先切换到另一项。');
    const profile: ModelProfile = {
      ...parsed,
      id,
      name,
      providerName: parsed.providerName.trim(),
      baseUrl: parsed.baseUrl.trim(),
      model: parsed.model.trim(),
    };
    const next = existing
      ? profiles.map((item) => (item.id === id ? profile : item))
      : [...profiles, profile];
    if (next.length > 20) throw new Error('最多保存 20 个模型配置，请先删除不用的配置。');
    const previousKey = existing ? this.credentials.read(existing.id, existing.baseUrl) : '',
      endpointChanged =
        !!existing && buildChatUrl(existing.baseUrl) !== buildChatUrl(profile.baseUrl),
      credentialChange = apiKey !== undefined || endpointChanged;
    if (endpointChanged && previousKey && apiKey === undefined)
      throw new Error('修改接口地址时必须同时重新填写 API 密钥；原模型配置和密钥均未改变。');
    if (credentialChange) {
      if (apiKey !== undefined) this.credentials.write(id, profile.baseUrl, apiKey);
      else this.credentials.remove(id);
    }
    try {
      this.store.updateSettings({
        modelProfiles: next,
        activeModelProfileId: settings.activeModelProfileId ?? id,
      });
    } catch (error) {
      if (credentialChange)
        try {
          if (existing && previousKey) this.credentials.write(id, existing.baseUrl, previousKey);
          else this.credentials.remove(id);
        } catch {
          /* Keep the original database error; encrypted credential recovery is best effort. */
        }
      throw error;
    }
    return id;
  }

  activate(id: string): void {
    this.requireIdle();
    const profile = this.require(id);
    if (!profile.enabled) throw new Error('这个模型配置已停用，请先启用后再切换。');
    if (!this.credentials.read(profile.id, profile.baseUrl))
      throw new Error('这个模型配置还没有可用的 API 密钥，请先在设置中完成配置。');
    const settings = this.store.getSettings();
    if (settings.activeModelProfileId !== id)
      this.store.updateSettings({ activeModelProfileId: id });
  }

  remove(id: string): void {
    this.requireIdle();
    const settings = this.store.getSettings(),
      profile = this.require(id);
    if (settings.activeModelProfileId === id)
      throw new Error('当前模型配置不能删除，请先切换到另一项。');
    const next = this.list().filter((item) => item.id !== id);
    if (!next.some((item) => item.enabled)) throw new Error('至少需要保留一个可用的模型配置。');
    const previousKey = this.credentials.read(id, profile.baseUrl);
    this.credentials.remove(id);
    try {
      this.store.updateSettings({ modelProfiles: next });
    } catch (error) {
      if (previousKey)
        try {
          this.credentials.write(id, profile.baseUrl, previousKey);
        } catch {
          /* Keep the database error; encrypted credential recovery is best effort. */
        }
      throw error;
    }
  }

  context(id = this.store.getSettings().activeModelProfileId): ModelCallContext {
    const current = this.store.getSettings(),
      profile = this.require(String(id ?? ''));
    if (!profile.enabled) throw new Error('这个模型配置已停用。');
    const settings: Settings = {
      ...current,
      activeModelProfileId: profile.id,
      providerName: profile.providerName,
      baseUrl: profile.baseUrl,
      model: profile.model,
      maxOutputTokens: profile.maxOutputTokens ?? DEFAULT_MODEL_OUTPUT_TOKENS,
      inputPriceCnyPerMillion: profile.inputPriceCnyPerMillion,
      outputPriceCnyPerMillion: profile.outputPriceCnyPerMillion,
      priceUpdatedAt: profile.priceUpdatedAt,
      hasApiKey: false,
    };
    return { profile, settings, key: this.credentials.read(profile.id, profile.baseUrl) };
  }
}
