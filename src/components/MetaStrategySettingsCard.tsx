import { useMemo, useState } from "react";
import { CollapsibleCard } from "./CollapsibleCard";
import { getMetaConfig } from "../config/metaConfig";
import {
  DEFAULT_META_OPTIMIZATION_CONFIG,
  getMetaPresetConfig,
  resetMetaPresetConfig,
  saveMetaPresetConfig,
  type MetaIndustryPreset,
  type MetaManagedAccount,
  type MetaOptimizationConfig,
  type MetaPresetConfigV1,
} from "../config/metaPresetConfig";
import { listMetaAdAccounts } from "../lib/metaGraphApi";
import { listMetaGoals, type MetaAdGoalKey } from "../lib/metaGoals";

type MsgKind = "success" | "info" | "warn" | "error";
type PlacementOption = { value: string; label: string };

const FB_POSITION_OPTIONS: PlacementOption[] = [
  { value: "feed", label: "Facebook 動態消息" },
  { value: "profile_feed", label: "Facebook 個人檔案動態消息" },
  { value: "story", label: "Facebook 限時動態" },
  { value: "facebook_reels", label: "Facebook Reels" },
  { value: "video_feeds", label: "Facebook 影片動態消息" },
  { value: "search", label: "Facebook 搜尋結果" },
  { value: "marketplace", label: "Facebook Marketplace" },
  { value: "right_hand_column", label: "Facebook 右欄" },
];

const IG_POSITION_OPTIONS: PlacementOption[] = [
  { value: "stream", label: "Instagram 動態消息" },
  { value: "story", label: "Instagram 限時動態" },
  { value: "reels", label: "Instagram Reels" },
  { value: "explore", label: "Instagram 探索" },
  { value: "profile_feed", label: "Instagram 個人檔案動態消息" },
  { value: "search", label: "Instagram 搜尋結果" },
];

function toggleValue(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function normalizeKey(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function countLines(raw: string) {
  return raw
    .split(/[\r\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean).length;
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
    label: "新產業模板",
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

function formatGender(value: MetaIndustryPreset["gender"]) {
  if (value === "male") return "男性";
  if (value === "female") return "女性";
  return "不限";
}

function optimizationSummary(cfg: MetaOptimizationConfig) {
  if (!cfg.enabled) return "已停用優化提醒";
  return [
    `最低觀察花費 NT$ ${cfg.minSpendForAdvice.toLocaleString("zh-TW")}`,
    `CTR < ${cfg.lowCtrThreshold}%`,
    `CPM > NT$ ${cfg.highCpmThreshold}`,
    `CPC > NT$ ${cfg.highCpcThreshold}`,
    `單位成果成本 > NT$ ${cfg.highCostPerResultThreshold}`,
  ].join(" / ");
}

function goalSummary(industry: MetaIndustryPreset, goalMap: Map<string, string>) {
  if (industry.recommendedGoals.length === 0) return "未設定";
  return industry.recommendedGoals.map((key) => goalMap.get(key) || key).join("、");
}

function renderPlacementGroup(params: {
  title: string;
  options: PlacementOption[];
  values: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="placement-col">
      <div className="placement-title">{params.title}</div>
      {params.options.map((option) => (
        <label className="check-row" key={`${params.title}-${option.value}`}>
          <input type="checkbox" checked={params.values.includes(option.value)} onChange={() => params.onToggle(option.value)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function MetaStrategySettingsCard(props: {
  onNotice: (kind: MsgKind, text: string, ms?: number) => void;
}) {
  const { onNotice } = props;
  const [cfg, setCfg] = useState<MetaPresetConfigV1>(() => getMetaPresetConfig());
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const goals = useMemo(() => listMetaGoals(), []);
  const goalLabelMap = useMemo(() => new Map(goals.map((goal) => [goal.key, goal.label])), [goals]);

  const save = () => {
    saveMetaPresetConfig(cfg);
    setCfg(getMetaPresetConfig());
    onNotice("success", "Meta 投放策略已儲存。", 2600);
  };

  const reset = () => {
    resetMetaPresetConfig();
    setCfg(getMetaPresetConfig());
    onNotice("info", "Meta 投放策略已重設為預設值。", 2600);
  };

  const setAccountField = <K extends keyof MetaManagedAccount>(index: number, field: K, value: MetaManagedAccount[K]) => {
    setCfg((current) => ({
      ...current,
      accounts: current.accounts.map((account, currentIndex) => (currentIndex === index ? { ...account, [field]: value } : account)),
    }));
  };

  const setIndustryField = <K extends keyof MetaIndustryPreset>(index: number, field: K, value: MetaIndustryPreset[K]) => {
    setCfg((current) => ({
      ...current,
      industries: current.industries.map((industry, currentIndex) => (currentIndex === index ? { ...industry, [field]: value } : industry)),
    }));
  };

  const setOptimizationField = <K extends keyof MetaOptimizationConfig>(field: K, value: MetaOptimizationConfig[K]) => {
    setCfg((current) => ({
      ...current,
      optimization: {
        ...current.optimization,
        [field]: value,
      },
    }));
  };

  const loadAccountsFromMeta = async () => {
    setLoadingAccounts(true);
    try {
      const result = await listMetaAdAccounts({ cfg: getMetaConfig() });
      if (!result.ok || !result.accounts || result.accounts.length === 0) {
        onNotice("error", result.detail || "沒有取到可用的 Meta 廣告帳號。", 3800);
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

  const defaultAccount = cfg.accounts.find((account) => account.id === cfg.defaultAccountId) ?? null;
  const enabledAccounts = cfg.accounts.filter((account) => account.enabled).length;
  const enabledIndustries = cfg.industries.filter((industry) => industry.enabled).length;

  return (
    <CollapsibleCard
      accent="green"
      title="Meta 投放策略"
      desc="管理預設廣告帳號、產業模板與優化提醒。Meta 官方投廣頁會直接套用這裡的設定。"
      tag="Meta"
      storageKey="sec:meta-strategy"
      defaultOpen={false}
      actions={
        <>
          <button className="btn" type="button" onClick={reset}>
            重設
          </button>
          <button className="btn primary" type="button" onClick={save}>
            儲存策略
          </button>
        </>
      }
    >
      <div className="meta-strategy-grid">
        <div className="meta-strategy-summary">
          <div className="meta-strategy-card">
            <div className="card-hd">
              <div>
                <div className="card-title">目前預設帳號</div>
                <div className="card-desc">前台 Meta 投廣會直接使用這個帳號</div>
              </div>
              <span className="tag">{defaultAccount ? "已設定" : "未設定"}</span>
            </div>
            <div className="card-bd">
              <div style={{ fontWeight: 800 }}>{defaultAccount ? `${defaultAccount.label} / act_${defaultAccount.adAccountId}` : "尚未指定帳號"}</div>
              <div className="meta-strategy-summary-line" style={{ marginTop: 8 }}>
                Facebook 粉專：{defaultAccount?.pageName || defaultAccount?.pageId || "未設定"}
              </div>
              <div className="meta-strategy-summary-line">Instagram Actor：{defaultAccount?.instagramActorId || "未設定"}</div>
            </div>
          </div>

          <div className="meta-strategy-card">
            <div className="card-hd">
              <div>
                <div className="card-title">策略摘要</div>
                <div className="card-desc">快速確認可用帳號、模板與提醒門檻</div>
              </div>
              <span className="tag">{cfg.optimization.enabled ? "提醒啟用" : "提醒停用"}</span>
            </div>
            <div className="card-bd">
              <div className="meta-strategy-summary-line">可用帳號：{enabledAccounts} 個</div>
              <div className="meta-strategy-summary-line">可用模板：{enabledIndustries} 個</div>
              <div className="meta-strategy-summary-line">達標檢查頻率：每 {cfg.autoStopCheckMinutes} 分鐘</div>
              <div className="meta-strategy-summary-line">優化門檻：{optimizationSummary(cfg.optimization)}</div>
            </div>
          </div>
        </div>

        <div className="meta-strategy-card">
          <div className="card-hd">
            <div>
              <div className="card-title">基本設定</div>
              <div className="card-desc">預設帳號與達標檢查頻率</div>
            </div>
          </div>
          <div className="card-bd">
            <div className="row cols2">
              <div className="field">
                <div className="label">預設廣告帳號</div>
                <select value={cfg.defaultAccountId} onChange={(event) => setCfg((current) => ({ ...current, defaultAccountId: event.target.value }))}>
                  <option value="">請選擇帳號</option>
                  {cfg.accounts
                    .filter((account) => account.enabled)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.label} / act_{account.adAccountId}
                      </option>
                    ))}
                </select>
                <div className="hint">前台不會再讓使用者自行切換帳號。</div>
              </div>
              <div className="field">
                <div className="label">達標檢查頻率</div>
                <input
                  inputMode="numeric"
                  value={String(cfg.autoStopCheckMinutes)}
                  onChange={(event) => setCfg((current) => ({ ...current, autoStopCheckMinutes: Number(event.target.value) || 5 }))}
                />
                <div className="hint">單位為分鐘，供成效頁與背景同步判斷是否達標停投。</div>
              </div>
            </div>
          </div>
        </div>

        <div className="meta-strategy-card">
          <div className="card-hd">
            <div>
              <div className="card-title">優化提醒</div>
              <div className="card-desc">先提供建議，不直接自動改動投放設定</div>
            </div>
          </div>
          <div className="card-bd">
            <div className="row cols3">
              <div className="field">
                <div className="label">提醒狀態</div>
                <select value={cfg.optimization.enabled ? "on" : "off"} onChange={(event) => setOptimizationField("enabled", event.target.value === "on")}>
                  <option value="on">啟用</option>
                  <option value="off">停用</option>
                </select>
              </div>
              <div className="field">
                <div className="label">最低觀察花費</div>
                <input inputMode="decimal" value={String(cfg.optimization.minSpendForAdvice)} onChange={(event) => setOptimizationField("minSpendForAdvice", Number(event.target.value) || 0)} />
              </div>
              <div className="field">
                <div className="label">CTR 偏低門檻</div>
                <input inputMode="decimal" value={String(cfg.optimization.lowCtrThreshold)} onChange={(event) => setOptimizationField("lowCtrThreshold", Number(event.target.value) || 0)} />
              </div>
              <div className="field">
                <div className="label">CPM 偏高門檻</div>
                <input inputMode="decimal" value={String(cfg.optimization.highCpmThreshold)} onChange={(event) => setOptimizationField("highCpmThreshold", Number(event.target.value) || 0)} />
              </div>
              <div className="field">
                <div className="label">CPC 偏高門檻</div>
                <input inputMode="decimal" value={String(cfg.optimization.highCpcThreshold)} onChange={(event) => setOptimizationField("highCpcThreshold", Number(event.target.value) || 0)} />
              </div>
              <div className="field">
                <div className="label">單位成果成本門檻</div>
                <input
                  inputMode="decimal"
                  value={String(cfg.optimization.highCostPerResultThreshold)}
                  onChange={(event) => setOptimizationField("highCostPerResultThreshold", Number(event.target.value) || 0)}
                />
              </div>
            </div>
            <div className="actions">
              <button
                className="btn"
                type="button"
                onClick={() =>
                  setCfg((current) => ({
                    ...current,
                    optimization: { ...DEFAULT_META_OPTIMIZATION_CONFIG },
                  }))
                }
              >
                還原預設門檻
              </button>
            </div>
          </div>
        </div>

        <div className="meta-strategy-card">
          <div className="card-hd">
            <div>
              <div className="card-title">廣告帳號清單</div>
              <div className="card-desc">每個帳號可對應不同廣告帳戶、Facebook 粉專與 Instagram Actor</div>
            </div>
            <div className="actions inline">
              <button className="btn" type="button" onClick={loadAccountsFromMeta} disabled={loadingAccounts}>
                {loadingAccounts ? "匯入中..." : "從 Meta 匯入"}
              </button>
              <button className="btn" type="button" onClick={() => setCfg((current) => ({ ...current, accounts: [...current.accounts, blankAccount()] }))}>
                新增帳號
              </button>
            </div>
          </div>
          <div className="card-bd">
            {cfg.accounts.length === 0 ? (
              <div className="hint">尚未建立 Meta 廣告帳號。若權限足夠，可直接從 Meta 匯入。</div>
            ) : (
              cfg.accounts.map((account, index) => (
                <details className="meta-strategy-item" key={account.id} open={index === 0}>
                  <summary>
                    <div>
                      <div className="item-title">{account.label || `帳號 ${index + 1}`}</div>
                      <div className="meta-strategy-summary-line">
                        act_{account.adAccountId || "未填寫"} / 粉專 {account.pageName || account.pageId || "未設定"}
                      </div>
                    </div>
                    <div className="actions inline">
                      <span className="tag">{cfg.defaultAccountId === account.id ? "預設" : account.enabled ? "啟用" : "停用"}</span>
                      <button
                        className="btn"
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          setCfg((current) => ({
                            ...current,
                            defaultAccountId: current.defaultAccountId === account.id ? "" : account.id,
                          }));
                        }}
                      >
                        {cfg.defaultAccountId === account.id ? "取消預設" : "設為預設"}
                      </button>
                      <button
                        className="btn danger sm"
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          setCfg((current) => ({
                            ...current,
                            accounts: current.accounts.filter((_, currentIndex) => currentIndex !== index),
                            defaultAccountId: current.defaultAccountId === account.id ? "" : current.defaultAccountId,
                          }));
                        }}
                      >
                        刪除
                      </button>
                    </div>
                  </summary>
                  <div className="meta-strategy-item-body">
                    <div className="row cols2">
                      <div className="field">
                        <div className="label">顯示名稱</div>
                        <input value={account.label} onChange={(event) => setAccountField(index, "label", event.target.value)} />
                      </div>
                      <div className="field">
                        <div className="label">狀態</div>
                        <select value={account.enabled ? "on" : "off"} onChange={(event) => setAccountField(index, "enabled", event.target.value === "on")}>
                          <option value="on">啟用</option>
                          <option value="off">停用</option>
                        </select>
                      </div>
                      <div className="field">
                        <div className="label">廣告帳號 ID</div>
                        <input value={account.adAccountId} onChange={(event) => setAccountField(index, "adAccountId", event.target.value.trim().replace(/^act_/i, ""))} />
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
                        <input value={account.instagramActorId} onChange={(event) => setAccountField(index, "instagramActorId", event.target.value.trim())} />
                      </div>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </div>

        <div className="meta-strategy-card">
          <div className="card-hd">
            <div>
              <div className="card-title">產業模板</div>
              <div className="card-desc">定義各產業的預設目標、受眾、版位與預算</div>
            </div>
            <button className="btn" type="button" onClick={() => setCfg((current) => ({ ...current, industries: [...current.industries, blankIndustry()] }))}>
              新增模板
            </button>
          </div>
          <div className="card-bd">
            {cfg.industries.map((industry, index) => (
              <details className="meta-strategy-item" key={industry.key} open={index === 0}>
                <summary>
                  <div>
                    <div className="item-title">{industry.label || `模板 ${index + 1}`}</div>
                    <div className="meta-strategy-summary-line">
                      目標：{goalSummary(industry, goalLabelMap)} / 地區：{industry.countriesCsv || "TW"} / 受眾條件：{countLines(industry.detailedTargetingText)} 筆
                    </div>
                  </div>
                  <div className="actions inline">
                    <span className="tag">{industry.enabled ? "啟用" : "停用"}</span>
                    <button
                      className="btn danger sm"
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        setCfg((current) => ({
                          ...current,
                          industries: current.industries.filter((_, currentIndex) => currentIndex !== index),
                        }));
                      }}
                    >
                      刪除
                    </button>
                  </div>
                </summary>
                <div className="meta-strategy-item-body">
                  <div className="row cols2">
                    <div className="field">
                      <div className="label">模板代號</div>
                      <input value={industry.key} onChange={(event) => setIndustryField(index, "key", normalizeKey(event.target.value) || industry.key)} />
                    </div>
                    <div className="field">
                      <div className="label">狀態</div>
                      <select value={industry.enabled ? "on" : "off"} onChange={(event) => setIndustryField(index, "enabled", event.target.value === "on")}>
                        <option value="on">啟用</option>
                        <option value="off">停用</option>
                      </select>
                    </div>
                    <div className="field">
                      <div className="label">模板名稱</div>
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
                      <input inputMode="numeric" value={String(industry.dailyBudget)} onChange={(event) => setIndustryField(index, "dailyBudget", Number(event.target.value) || 0)} />
                    </div>
                  </div>

                  <div className="row cols3" style={{ marginTop: 10 }}>
                    <div className="field">
                      <div className="label">最小年齡</div>
                      <input inputMode="numeric" value={String(industry.ageMin)} onChange={(event) => setIndustryField(index, "ageMin", Number(event.target.value) || 18)} />
                    </div>
                    <div className="field">
                      <div className="label">最大年齡</div>
                      <input inputMode="numeric" value={String(industry.ageMax)} onChange={(event) => setIndustryField(index, "ageMax", Number(event.target.value) || 49)} />
                    </div>
                    <div className="field">
                      <div className="label">性別</div>
                      <select value={industry.gender} onChange={(event) => setIndustryField(index, "gender", event.target.value as MetaIndustryPreset["gender"])}>
                        <option value="all">不限</option>
                        <option value="male">男性</option>
                        <option value="female">女性</option>
                      </select>
                    </div>
                  </div>

                  <div className="meta-strategy-summary" style={{ marginTop: 10 }}>
                    <div className="meta-strategy-card">
                      <div className="card-bd">
                        <div className="meta-strategy-summary-line">年齡 / 性別</div>
                        <div style={{ fontWeight: 800, marginTop: 6 }}>
                          {industry.ageMin} - {industry.ageMax} / {formatGender(industry.gender)}
                        </div>
                      </div>
                    </div>
                    <div className="meta-strategy-card">
                      <div className="card-bd">
                        <div className="meta-strategy-summary-line">受眾補充</div>
                        <div style={{ fontWeight: 800, marginTop: 6 }}>{industry.audienceNote || "未設定"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="field" style={{ marginTop: 10 }}>
                    <div className="label">建議投放目標</div>
                    <div className="actions inline" style={{ flexWrap: "wrap" }}>
                      {goals.map((goal) => {
                        const selected = industry.recommendedGoals.includes(goal.key as MetaAdGoalKey);
                        return (
                          <button
                            key={`${industry.key}-${goal.key}`}
                            type="button"
                            className={`btn ${selected ? "primary" : ""}`}
                            onClick={() =>
                              setIndustryField(
                                index,
                                "recommendedGoals",
                                selected
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

                  <div className="row cols2" style={{ marginTop: 10 }}>
                    <div className="field">
                      <div className="label">興趣受眾</div>
                      <textarea
                        rows={3}
                        value={industry.detailedTargetingText}
                        onChange={(event) => setIndustryField(index, "detailedTargetingText", event.target.value)}
                        placeholder="每行一筆 interest_id，可加名稱，例如 6003139266461|Streetwear"
                      />
                    </div>
                    <div className="field">
                      <div className="label">受眾說明</div>
                      <textarea
                        rows={3}
                        value={industry.audienceNote}
                        onChange={(event) => setIndustryField(index, "audienceNote", event.target.value)}
                        placeholder="補充這組模板適合的受眾方向"
                      />
                    </div>
                    <div className="field">
                      <div className="label">包含自訂受眾 ID</div>
                      <textarea
                        rows={2}
                        value={industry.customAudienceIdsText}
                        onChange={(event) => setIndustryField(index, "customAudienceIdsText", event.target.value)}
                        placeholder="每行一筆 Audience ID"
                      />
                    </div>
                    <div className="field">
                      <div className="label">排除自訂受眾 ID</div>
                      <textarea
                        rows={2}
                        value={industry.excludedAudienceIdsText}
                        onChange={(event) => setIndustryField(index, "excludedAudienceIdsText", event.target.value)}
                        placeholder="每行一筆 Audience ID"
                      />
                    </div>
                  </div>

                  <div className="placement-grid" style={{ marginTop: 10 }}>
                    {renderPlacementGroup({
                      title: "Facebook 版位",
                      options: FB_POSITION_OPTIONS,
                      values: industry.fbPositions,
                      onToggle: (value) => setIndustryField(index, "fbPositions", toggleValue(industry.fbPositions, value)),
                    })}
                    {renderPlacementGroup({
                      title: "Instagram 版位",
                      options: IG_POSITION_OPTIONS,
                      values: industry.igPositions,
                      onToggle: (value) => setIndustryField(index, "igPositions", toggleValue(industry.igPositions, value)),
                    })}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </CollapsibleCard>
  );
}
