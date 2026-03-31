import { useMemo, useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { getMetaConfig } from "../config/metaConfig";
import {
  getMetaPresetConfig,
  resetMetaPresetConfig,
  saveMetaPresetConfig,
  type MetaIndustryPreset,
  type MetaManagedAccount,
  type MetaPresetConfigV1,
} from "../config/metaPresetConfig";
import { listMetaAdAccounts } from "../lib/metaGraphApi";
import { listMetaGoals, type MetaAdGoalKey } from "../lib/metaGoals";

type MsgKind = "success" | "info" | "warn" | "error";

const FB_POSITION_OPTIONS = [
  { value: "feed", label: "Facebook 動態消息" },
  { value: "profile_feed", label: "Facebook 個人檔案動態" },
  { value: "story", label: "Facebook 限時動態" },
  { value: "facebook_reels", label: "Facebook Reels" },
  { value: "video_feeds", label: "Facebook 影片動態" },
  { value: "search", label: "Facebook 搜尋結果" },
  { value: "marketplace", label: "Facebook Marketplace" },
  { value: "right_hand_column", label: "Facebook 右欄" },
];

const IG_POSITION_OPTIONS = [
  { value: "stream", label: "Instagram 動態消息" },
  { value: "story", label: "Instagram 限時動態" },
  { value: "reels", label: "Instagram Reels" },
  { value: "explore", label: "Instagram 探索" },
  { value: "profile_feed", label: "Instagram 個人檔案動態" },
  { value: "search", label: "Instagram 搜尋結果" },
];

function toggleValue(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function normalizeKey(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function blankAccount(): MetaManagedAccount {
  return {
    id: `account_${Date.now()}`,
    label: "新帳號",
    adAccountId: "",
    pageId: "",
    pageName: "",
    instagramActorId: "",
    enabled: true,
  };
}

function blankIndustry(): MetaIndustryPreset {
  return {
    key: `industry_${Date.now()}`,
    label: "新產業",
    description: "",
    enabled: true,
    recommendedGoals: [],
    countriesCsv: "TW",
    ageMin: 18,
    ageMax: 49,
    gender: "all",
    detailedTargetingText: "",
    customAudienceIdsText: "",
    excludedAudienceIdsText: "",
    audienceNote: "",
    dailyBudget: 1000,
    ctaType: "LEARN_MORE",
    useExistingPost: true,
    fbPositions: ["feed", "profile_feed", "story", "facebook_reels"],
    igPositions: ["stream", "story", "reels", "explore"],
  };
}

export function MetaStrategySettingsCard(props: {
  onNotice: (kind: MsgKind, text: string, ms?: number) => void;
}) {
  const { onNotice } = props;
  const [cfg, setCfg] = useState<MetaPresetConfigV1>(() => getMetaPresetConfig());
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const goals = useMemo(() => listMetaGoals(), []);

  const save = () => {
    saveMetaPresetConfig(cfg);
    setCfg(getMetaPresetConfig());
    onNotice("success", "Meta 投放策略已儲存。", 2800);
  };

  const reset = () => {
    resetMetaPresetConfig();
    setCfg(getMetaPresetConfig());
    onNotice("info", "Meta 投放策略已重設。", 2800);
  };

  const setAccountField = <K extends keyof MetaManagedAccount>(index: number, field: K, value: MetaManagedAccount[K]) => {
    setCfg((current) => ({
      ...current,
      accounts: current.accounts.map((account, currentIndex) =>
        currentIndex === index ? { ...account, [field]: value } : account,
      ),
    }));
  };

  const setIndustryField = <K extends keyof MetaIndustryPreset>(index: number, field: K, value: MetaIndustryPreset[K]) => {
    setCfg((current) => ({
      ...current,
      industries: current.industries.map((industry, currentIndex) =>
        currentIndex === index ? { ...industry, [field]: value } : industry,
      ),
    }));
  };

  const loadAccountsFromMeta = async () => {
    setLoadingAccounts(true);
    try {
      const result = await listMetaAdAccounts({ cfg: getMetaConfig() });
      if (!result.ok || !result.accounts || result.accounts.length === 0) {
        onNotice("error", result.detail || "沒有取得可用的 Meta 廣告帳號。", 3800);
        return;
      }

      setCfg((current) => {
        const merged = [...current.accounts];
        for (const account of result.accounts ?? []) {
          const nextAccount: MetaManagedAccount = {
            id: normalizeKey(account.id || account.adAccountId) || `account_${Date.now()}`,
            label: account.label,
            adAccountId: account.adAccountId,
            pageId: account.pageId || "",
            pageName: account.pageName || "",
            instagramActorId: account.instagramActorId || "",
            enabled: true,
          };
          const existingIndex = merged.findIndex((row) => row.adAccountId === account.adAccountId);
          if (existingIndex >= 0) merged[existingIndex] = { ...merged[existingIndex], ...nextAccount };
          else merged.push(nextAccount);
        }
        return {
          ...current,
          accounts: merged,
          defaultAccountId: current.defaultAccountId || merged.find((account) => account.enabled)?.id || "",
        };
      });

      onNotice("success", `已匯入 ${result.accounts.length} 個 Meta 廣告帳號。`, 3000);
    } finally {
      setLoadingAccounts(false);
    }
  };

  return (
    <CollapsibleCard
      accent="green"
      title="Meta 投放策略"
      desc="設定預設帳號、產業模板與自動停投檢查頻率。下單頁會直接套用這裡的設定。"
      tag="策略"
      storageKey="sec:meta-strategy"
      defaultOpen={false}
    >
      <div className="row cols2" style={{ marginBottom: 12 }}>
        <div className="field">
          <div className="label">自動停投檢查頻率（分鐘）</div>
          <input
            value={String(cfg.autoStopCheckMinutes)}
            inputMode="numeric"
            onChange={(event) =>
              setCfg((current) => ({
                ...current,
                autoStopCheckMinutes: Number(event.target.value) || 5,
              }))
            }
          />
          <div className="hint">成效頁會依這個頻率檢查進行中的 Meta 案件是否已達標。</div>
        </div>
        <div className="field">
          <div className="label">預設投放帳號</div>
          <select
            value={cfg.defaultAccountId}
            onChange={(event) => setCfg((current) => ({ ...current, defaultAccountId: event.target.value }))}
          >
            <option value="">請選擇</option>
            {cfg.accounts.filter((account) => account.enabled).map((account) => (
              <option key={account.id} value={account.id}>
                {account.label} / act_{account.adAccountId}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="actions inline" style={{ marginBottom: 12 }}>
        <button className="btn" type="button" onClick={loadAccountsFromMeta} disabled={loadingAccounts}>
          {loadingAccounts ? "匯入中..." : "從 Meta 匯入廣告帳號"}
        </button>
        <button className="btn" type="button" onClick={() => setCfg((current) => ({ ...current, accounts: [...current.accounts, blankAccount()] }))}>
          新增帳號
        </button>
      </div>

      <div className="list" style={{ marginBottom: 12 }}>
        {cfg.accounts.length === 0 ? (
          <div className="hint">尚未建立 Meta 投放帳號。若 token 權限足夠，可直接從 Meta 匯入。</div>
        ) : (
          cfg.accounts.map((account, index) => (
            <div className="item" key={account.id}>
              <div className="item-hd">
                <div className="item-title">{account.label || `帳號 ${index + 1}`}</div>
                <div className="actions inline">
                  <span className="tag">{cfg.defaultAccountId === account.id ? "預設" : account.enabled ? "啟用中" : "停用"}</span>
                  <button
                    className="btn danger sm"
                    type="button"
                    onClick={() =>
                      setCfg((current) => ({
                        ...current,
                        accounts: current.accounts.filter((_, currentIndex) => currentIndex !== index),
                        defaultAccountId:
                          current.defaultAccountId === account.id
                            ? current.accounts.find((_, currentIndex) => currentIndex !== index && current.accounts[currentIndex].enabled)?.id || ""
                            : current.defaultAccountId,
                      }))
                    }
                  >
                    刪除
                  </button>
                </div>
              </div>

              <div className="row cols2">
                <div className="field">
                  <div className="label">顯示名稱</div>
                  <input value={account.label} onChange={(event) => setAccountField(index, "label", event.target.value)} />
                </div>
                <div className="field">
                  <div className="label">狀態</div>
                  <select
                    value={account.enabled ? "on" : "off"}
                    onChange={(event) => setAccountField(index, "enabled", event.target.value === "on")}
                  >
                    <option value="on">啟用</option>
                    <option value="off">停用</option>
                  </select>
                </div>
                <div className="field">
                  <div className="label">廣告帳號 ID</div>
                  <input
                    value={account.adAccountId}
                    onChange={(event) => setAccountField(index, "adAccountId", event.target.value.trim().replace(/^act_/i, ""))}
                    placeholder="1234567890"
                  />
                </div>
                <div className="field">
                  <div className="label">Facebook 粉專 ID</div>
                  <input value={account.pageId} onChange={(event) => setAccountField(index, "pageId", event.target.value.trim())} />
                </div>
                <div className="field">
                  <div className="label">粉專名稱</div>
                  <input value={account.pageName} onChange={(event) => setAccountField(index, "pageName", event.target.value)} />
                </div>
                <div className="field">
                  <div className="label">Instagram Actor ID</div>
                  <input
                    value={account.instagramActorId}
                    onChange={(event) => setAccountField(index, "instagramActorId", event.target.value.trim())}
                  />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="sep" />

      <div className="actions inline" style={{ marginBottom: 12 }}>
        <button className="btn" type="button" onClick={() => setCfg((current) => ({ ...current, industries: [...current.industries, blankIndustry()] }))}>
          新增產業模板
        </button>
      </div>

      <div className="list">
        {cfg.industries.map((industry, index) => (
          <div className="item" key={industry.key}>
            <div className="item-hd">
              <div className="item-title">{industry.label}</div>
              <div className="actions inline">
                <span className="tag">{industry.enabled ? "啟用中" : "停用"}</span>
                <button
                  className="btn danger sm"
                  type="button"
                  onClick={() =>
                    setCfg((current) => ({
                      ...current,
                      industries: current.industries.filter((_, currentIndex) => currentIndex !== index),
                    }))
                  }
                >
                  刪除
                </button>
              </div>
            </div>

            <div className="row cols2">
              <div className="field">
                <div className="label">產業代碼</div>
                <input
                  value={industry.key}
                  onChange={(event) => setIndustryField(index, "key", normalizeKey(event.target.value) || industry.key)}
                />
              </div>
              <div className="field">
                <div className="label">狀態</div>
                <select
                  value={industry.enabled ? "on" : "off"}
                  onChange={(event) => setIndustryField(index, "enabled", event.target.value === "on")}
                >
                  <option value="on">啟用</option>
                  <option value="off">停用</option>
                </select>
              </div>
              <div className="field">
                <div className="label">顯示名稱</div>
                <input value={industry.label} onChange={(event) => setIndustryField(index, "label", event.target.value)} />
              </div>
              <div className="field">
                <div className="label">說明</div>
                <input value={industry.description} onChange={(event) => setIndustryField(index, "description", event.target.value)} />
              </div>
              <div className="field">
                <div className="label">投放地區</div>
                <input value={industry.countriesCsv} onChange={(event) => setIndustryField(index, "countriesCsv", event.target.value.trim())} placeholder="TW 或 TW,HK" />
              </div>
              <div className="field">
                <div className="label">建議日預算</div>
                <input value={String(industry.dailyBudget)} inputMode="numeric" onChange={(event) => setIndustryField(index, "dailyBudget", Number(event.target.value) || 0)} />
              </div>
              <div className="field">
                <div className="label">年齡區間</div>
                <div className="row cols2">
                  <input value={String(industry.ageMin)} inputMode="numeric" onChange={(event) => setIndustryField(index, "ageMin", Number(event.target.value) || 18)} />
                  <input value={String(industry.ageMax)} inputMode="numeric" onChange={(event) => setIndustryField(index, "ageMax", Number(event.target.value) || 49)} />
                </div>
              </div>
              <div className="field">
                <div className="label">性別</div>
                <select value={industry.gender} onChange={(event) => setIndustryField(index, "gender", event.target.value as MetaIndustryPreset["gender"])}>
                  <option value="all">不限</option>
                  <option value="male">男性</option>
                  <option value="female">女性</option>
                </select>
              </div>
              <div className="field">
                <div className="label">CTA 預設值</div>
                <input value={industry.ctaType} onChange={(event) => setIndustryField(index, "ctaType", event.target.value.trim())} />
              </div>
              <div className="field">
                <div className="label">預設使用現有貼文</div>
                <select value={industry.useExistingPost ? "yes" : "no"} onChange={(event) => setIndustryField(index, "useExistingPost", event.target.value === "yes")}>
                  <option value="yes">是</option>
                  <option value="no">否</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <div className="label">建議投放目標</div>
                <div className="placement-grid">
                  {goals.map((goal) => {
                    const active = industry.recommendedGoals.includes(goal.key);
                    return (
                      <button
                        key={goal.key}
                        className={`btn sm ${active ? "primary" : ""}`}
                        type="button"
                        onClick={() =>
                          setIndustryField(
                            index,
                            "recommendedGoals",
                            active
                              ? industry.recommendedGoals.filter((item) => item !== goal.key)
                              : [...industry.recommendedGoals, goal.key as MetaAdGoalKey],
                          )
                        }
                      >
                        {goal.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <div className="label">興趣受眾</div>
                <textarea rows={3} value={industry.detailedTargetingText} onChange={(event) => setIndustryField(index, "detailedTargetingText", event.target.value)} placeholder="每行一筆 interest_id，可加名稱，例如 6003139266461|Streetwear" />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <div className="label">受眾備註</div>
                <textarea rows={2} value={industry.audienceNote} onChange={(event) => setIndustryField(index, "audienceNote", event.target.value)} placeholder="描述這組模板要鎖定的受眾方向" />
              </div>
              <div className="field">
                <div className="label">包含自訂受眾 ID</div>
                <textarea rows={2} value={industry.customAudienceIdsText} onChange={(event) => setIndustryField(index, "customAudienceIdsText", event.target.value)} placeholder="每行一筆 Audience ID" />
              </div>
              <div className="field">
                <div className="label">排除自訂受眾 ID</div>
                <textarea rows={2} value={industry.excludedAudienceIdsText} onChange={(event) => setIndustryField(index, "excludedAudienceIdsText", event.target.value)} placeholder="每行一筆 Audience ID" />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <div className="label">Facebook 版位</div>
                <div className="placement-grid">
                  {FB_POSITION_OPTIONS.map((option) => {
                    const active = industry.fbPositions.includes(option.value);
                    return (
                      <button
                        key={`fb-${option.value}`}
                        className={`btn sm ${active ? "primary" : ""}`}
                        type="button"
                        onClick={() => setIndustryField(index, "fbPositions", toggleValue(industry.fbPositions, option.value))}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <div className="label">Instagram 版位</div>
                <div className="placement-grid">
                  {IG_POSITION_OPTIONS.map((option) => {
                    const active = industry.igPositions.includes(option.value);
                    return (
                      <button
                        key={`ig-${option.value}`}
                        className={`btn sm ${active ? "primary" : ""}`}
                        type="button"
                        onClick={() => setIndustryField(index, "igPositions", toggleValue(industry.igPositions, option.value))}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="sep" />
      <div className="actions inline">
        <button className="btn" type="button" onClick={reset}>
          重設
        </button>
        <button className="btn primary" type="button" onClick={save}>
          儲存 Meta 投放策略
        </button>
      </div>
    </CollapsibleCard>
  );
}