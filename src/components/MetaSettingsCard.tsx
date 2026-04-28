import { useEffect, useMemo, useState } from "react";
import { fetchMetaConfigFromServer, saveMetaConfigToServer, type MetaConfigV1 } from "../config/metaConfig";
import { apiUrl } from "../lib/apiBase";
import { CollapsibleCard } from "./CollapsibleCard";

type TokenScope = "user" | "ads" | "facebook" | "instagram";

type MetaAdAccountOption = {
  id: string;
  graphId?: string;
  name: string;
  accountStatus?: string;
  currency?: string;
  timezoneName?: string;
  businessId?: string;
  businessName?: string;
  source?: string;
};

type MetaPageOption = {
  id: string;
  name: string;
  category?: string;
  instagramActorId?: string;
  instagramUsername?: string;
};

type MetaInstagramOption = {
  id: string;
  username: string;
  pageId?: string;
  pageName?: string;
};

type MetaAccountsResponse = {
  ok: boolean;
  error?: string;
  adAccounts?: MetaAdAccountOption[];
  pages?: MetaPageOption[];
  instagramAccounts?: MetaInstagramOption[];
  fetchedAt?: string;
};

type OAuthStatusResponse = {
  ok: boolean;
  error?: string;
  status?: string;
  config?: MetaConfigV1["oauth"];
};

const TOKEN_SCOPES: Array<{ scope: TokenScope; label: string; desc: string }> = [
  { scope: "user", label: "Meta User Key", desc: "通用 Key。若下方服務沒有另外設定，Meta Ads、Facebook、Instagram 都會使用這把 Key。" },
  { scope: "ads", label: "Meta Ads Key", desc: "選填。只覆蓋廣告帳號、建立廣告與 insights 相關功能。" },
  { scope: "facebook", label: "Facebook Page Key", desc: "選填。只覆蓋 Facebook 粉專、貼文解析與貼文成效讀取。" },
  { scope: "instagram", label: "Instagram Key", desc: "選填。只覆蓋 Instagram media / insights 相關功能。" },
];

function sourceText(cfg: MetaConfigV1, scope: Exclude<TokenScope, "user">) {
  const source = cfg.tokenSource?.[scope];
  if (source === "specific") return "使用專用 Key";
  if (source === "user") return "使用 User Key";
  return "未設定";
}

function statusText(cfg: MetaConfigV1, scope: TokenScope) {
  if (scope === "user") return cfg.tokenStatus?.user ? "User Key 已儲存" : "User Key 未設定";
  if (cfg.tokenSource?.[scope] === "specific") return "專用 Key 已儲存";
  if (cfg.tokenSource?.[scope] === "user") return "使用 User Key";
  return "未設定";
}

function optionLabelForAdAccount(account: MetaAdAccountOption) {
  const name = account.name || account.id;
  const business = account.businessName ? ` / ${account.businessName}` : "";
  const currency = account.currency ? ` / ${account.currency}` : "";
  return `${name} / act_${account.id}${currency}${business}`;
}

function optionLabelForPage(page: MetaPageOption) {
  const ig = page.instagramUsername ? ` / IG：${page.instagramUsername}` : "";
  return `${page.name || page.id} / ${page.id}${ig}`;
}

function optionLabelForInstagram(account: MetaInstagramOption) {
  const page = account.pageName ? ` / 粉專：${account.pageName}` : "";
  return `${account.username || account.id} / ${account.id}${page}`;
}

function formatDateTime(value?: string) {
  if (!value) return "未取得";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString("zh-TW");
}

export function MetaSettingsCard(props: {
  onNotice: (tone: "success" | "error" | "info", text: string, timeout?: number) => void;
}) {
  const { onNotice } = props;
  const [cfg, setCfg] = useState<MetaConfigV1 | null>(null);
  const [tokens, setTokens] = useState<Record<TokenScope, string>>({ user: "", ads: "", facebook: "", instagram: "" });
  const [shortToken, setShortToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [verifying, setVerifying] = useState<Record<TokenScope, boolean>>({ user: false, ads: false, facebook: false, instagram: false });
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [adAccounts, setAdAccounts] = useState<MetaAdAccountOption[]>([]);
  const [pages, setPages] = useState<MetaPageOption[]>([]);
  const [instagramAccounts, setInstagramAccounts] = useState<MetaInstagramOption[]>([]);
  const [accountsFetchedAt, setAccountsFetchedAt] = useState("");

  const refreshConfig = async () => {
    const next = await fetchMetaConfigFromServer();
    setCfg(next);
    return next;
  };

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    fetchMetaConfigFromServer()
      .then((next) => {
        if (!canceled) setCfg(next);
      })
      .catch((error) => {
        if (!canceled) onNotice("error", `Meta 設定讀取失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [onNotice]);

  const selectedAdAccountId = cfg?.adAccountId || "";
  const selectedPageId = cfg?.pageId || "";
  const selectedInstagramId = cfg?.instagramActorId || "";

  const selectedAdAccount = useMemo(
    () => adAccounts.find((account) => account.id === selectedAdAccountId),
    [adAccounts, selectedAdAccountId],
  );

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId),
    [pages, selectedPageId],
  );

  const selectedInstagram = useMemo(
    () => instagramAccounts.find((account) => account.id === selectedInstagramId),
    [instagramAccounts, selectedInstagramId],
  );

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const next = await saveMetaConfigToServer({
        ...cfg,
        userAccessToken: tokens.user,
        adsAccessToken: tokens.ads,
        facebookAccessToken: tokens.facebook,
        instagramAccessToken: tokens.instagram,
      });
      setCfg(next);
      setTokens({ user: "", ads: "", facebook: "", instagram: "" });
      onNotice("success", "Meta 設定已儲存。", 2600);
    } catch (error) {
      onNotice("error", `Meta 設定儲存失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
    } finally {
      setSaving(false);
    }
  };

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const response = await fetch(apiUrl("/api/meta/accounts"), { headers: { "Cache-Control": "no-store" } });
      const data = (await response.json()) as MetaAccountsResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const nextAdAccounts = Array.isArray(data.adAccounts) ? data.adAccounts : [];
      const nextPages = Array.isArray(data.pages) ? data.pages : [];
      const nextIg = Array.isArray(data.instagramAccounts) ? data.instagramAccounts : [];
      setAdAccounts(nextAdAccounts);
      setPages(nextPages);
      setInstagramAccounts(nextIg);
      setAccountsFetchedAt(data.fetchedAt || new Date().toISOString());
      onNotice("success", `已載入 ${nextAdAccounts.length} 個廣告帳號、${nextPages.length} 個 Facebook 粉專、${nextIg.length} 個 Instagram 帳戶。`, 3000);
    } catch (error) {
      onNotice("error", `Meta 帳戶載入失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 5200);
    } finally {
      setAccountsLoading(false);
    }
  };

  const refreshOAuthStatus = async () => {
    setOauthBusy(true);
    try {
      const response = await fetch(apiUrl("/api/meta/token/status"), { headers: { "Cache-Control": "no-store" } });
      const data = (await response.json()) as OAuthStatusResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const next = await refreshConfig();
      onNotice("success", `Meta 授權狀態：${data.config?.status || next.oauth?.status || "未知"}`, 2600);
    } catch (error) {
      onNotice("error", `授權狀態確認失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
    } finally {
      setOauthBusy(false);
    }
  };

  const connectMeta = async () => {
    if (!cfg) return;
    setOauthBusy(true);
    try {
      await saveMetaConfigToServer(cfg);
      window.location.assign(apiUrl("/api/meta/oauth/start"));
    } catch (error) {
      setOauthBusy(false);
      onNotice("error", `啟動 Meta 授權失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
    }
  };

  const exchangeShortToken = async () => {
    if (!shortToken.trim()) {
      onNotice("error", "請先貼上短效 User Token。", 2600);
      return;
    }
    setOauthBusy(true);
    try {
      const response = await fetch(apiUrl("/api/meta/token/exchange-short-lived"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ short_lived_user_token: shortToken.trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setShortToken("");
      await refreshConfig();
      onNotice("success", "短效 User Token 已交換並儲存為長效 token。", 3200);
    } catch (error) {
      onNotice("error", `交換失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 5200);
    } finally {
      setOauthBusy(false);
    }
  };

  const disconnectMeta = async () => {
    setOauthBusy(true);
    try {
      const response = await fetch(apiUrl("/api/meta/disconnect"), { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      await refreshConfig();
      onNotice("success", "Meta token 已清除，App 設定仍保留。", 2800);
    } catch (error) {
      onNotice("error", `中斷授權失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
    } finally {
      setOauthBusy(false);
    }
  };

  const selectAdAccount = (adAccountId: string) => {
    if (!cfg) return;
    setCfg({ ...cfg, adAccountId });
  };

  const selectPage = (pageId: string) => {
    if (!cfg) return;
    const page = pages.find((item) => item.id === pageId);
    if (!page) {
      setCfg({ ...cfg, pageId: "", pageName: "" });
      return;
    }
    const linkedIg = page.instagramActorId
      ? instagramAccounts.find((item) => item.id === page.instagramActorId)
      : instagramAccounts.find((item) => item.pageId === page.id);
    setCfg({
      ...cfg,
      pageId: page.id,
      pageName: page.name,
      instagramActorId: linkedIg?.id || page.instagramActorId || cfg.instagramActorId,
    });
  };

  const selectInstagram = (instagramActorId: string) => {
    if (!cfg) return;
    const ig = instagramAccounts.find((item) => item.id === instagramActorId);
    if (!ig) {
      setCfg({ ...cfg, instagramActorId: "" });
      return;
    }
    const linkedPage = pages.find((page) => page.id === ig.pageId);
    setCfg({
      ...cfg,
      instagramActorId: ig.id,
      pageId: cfg.pageId || ig.pageId || linkedPage?.id || "",
      pageName: cfg.pageName || ig.pageName || linkedPage?.name || "",
    });
  };

  const clearToken = async (scope: TokenScope) => {
    if (!cfg) return;
    setSaving(true);
    try {
      const next = await saveMetaConfigToServer({ ...cfg, clearTokens: [scope] });
      setCfg(next);
      setTokens((state) => ({ ...state, [scope]: "" }));
      onNotice("success", `${TOKEN_SCOPES.find((item) => item.scope === scope)?.label ?? "Meta Key"} 已清除。`, 2600);
    } catch (error) {
      onNotice("error", `清除失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
    } finally {
      setSaving(false);
    }
  };

  const verify = async (scope: TokenScope) => {
    const token = tokens[scope].trim();
    if (!token) {
      onNotice("error", "請先貼上要驗證的 API Key。", 2600);
      return;
    }
    setVerifying((state) => ({ ...state, [scope]: true }));
    try {
      const response = await fetch(apiUrl("/api/meta/verify-token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, token, apiVersion: cfg?.apiVersion || "v20.0" }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const label = TOKEN_SCOPES.find((item) => item.scope === scope)?.label ?? "Meta API Key";
      onNotice("success", `${label} 驗證成功。`, 2600);
    } catch (error) {
      onNotice("error", `驗證失敗：${error instanceof Error ? error.message : "未知錯誤"}`, 4200);
    } finally {
      setVerifying((state) => ({ ...state, [scope]: false }));
    }
  };

  if (loading || !cfg) {
    return (
      <CollapsibleCard title="Meta 基本設定" desc="讀取中" tag="Meta" storageKey="sec:meta-settings">
        <div className="hint">正在讀取後端設定...</div>
      </CollapsibleCard>
    );
  }

  return (
    <CollapsibleCard title="Meta 基本設定" desc="Meta token 只存本機後端；前端只顯示狀態與遮罩資訊。" tag="Meta" storageKey="sec:meta-settings">
      <div className="row cols2">
        <label className="field">
          <div className="label">Graph API 版本</div>
          <input value={cfg.apiVersion} onChange={(event) => setCfg({ ...cfg, apiVersion: event.target.value.trim() || "v20.0" })} />
        </label>
        <label className="field">
          <div className="label">預設廣告帳號 ID</div>
          <input value={cfg.adAccountId} onChange={(event) => setCfg({ ...cfg, adAccountId: event.target.value.replace(/^act_/i, "") })} placeholder="可用下方載入帳戶選擇" />
          <div className="hint">這裡必須是廣告帳號 ID，不是 Business Manager ID。</div>
        </label>
      </div>

      <div className="sep" />

      <div className="meta-account-picker">
        <div className="meta-account-picker-head">
          <div>
            <div className="dense-title">Meta 長效授權</div>
            <p className="dense-meta">設定 App 後可走 Meta OAuth 取得長效 User Token；也可貼上圖形 API 測試工具產生的短效 User Token 交換。</p>
          </div>
          <div className="actions inline">
            <button className="btn" type="button" onClick={() => void refreshOAuthStatus()} disabled={oauthBusy}>更新狀態</button>
            <button className="btn primary" type="button" onClick={() => void connectMeta()} disabled={oauthBusy || !(cfg.metaAppId || cfg.oauth?.configured)}>Meta 授權登入</button>
          </div>
        </div>
        <div className="row cols2">
          <label className="field">
            <div className="label">Meta App ID</div>
            <input value={cfg.metaAppId} onChange={(event) => setCfg({ ...cfg, metaAppId: event.target.value.trim() })} placeholder={cfg.oauth?.appIdPreview || "貼上 App ID"} />
          </label>
          <label className="field">
            <div className="label">Meta App Secret</div>
            <input type="password" value={cfg.metaAppSecret} onChange={(event) => setCfg({ ...cfg, metaAppSecret: event.target.value.trim() })} placeholder={cfg.oauth?.configured ? "已設定；需要更換時再輸入" : "貼上 App Secret"} />
          </label>
          <label className="field">
            <div className="label">Login Configuration ID</div>
            <input value={cfg.metaLoginConfigId} onChange={(event) => setCfg({ ...cfg, metaLoginConfigId: event.target.value.trim() })} placeholder={cfg.oauth?.loginConfigIdPreview || "選填；Meta Login 新版設定 ID"} />
          </label>
          <label className="field">
            <div className="label">OAuth 回呼網址</div>
            <input value={cfg.metaRedirectUri || cfg.oauth?.redirectUri || ""} onChange={(event) => setCfg({ ...cfg, metaRedirectUri: event.target.value.trim() })} placeholder="http://127.0.0.1:8787/api/meta/oauth/callback" />
            <div className="hint">此網址需加入 Meta App 的 Valid OAuth Redirect URIs。</div>
          </label>
        </div>
        <div className="row cols2">
          <label className="field">
            <div className="label">授權成功返回頁</div>
            <input value={cfg.metaSuccessRedirect || cfg.oauth?.successRedirect || ""} onChange={(event) => setCfg({ ...cfg, metaSuccessRedirect: event.target.value.trim() })} />
          </label>
          <label className="field">
            <div className="label">授權失敗返回頁</div>
            <input value={cfg.metaErrorRedirect || cfg.oauth?.errorRedirect || ""} onChange={(event) => setCfg({ ...cfg, metaErrorRedirect: event.target.value.trim() })} />
          </label>
        </div>
        <div className="row cols2">
          <label className="field">
            <div className="label">短效 User Token 交換</div>
            <textarea value={shortToken} onChange={(event) => setShortToken(event.target.value.trim())} placeholder="可貼上圖形 API 測試工具的短效 User Token" rows={3} />
          </label>
          <div className="field">
            <div className="label">目前授權狀態</div>
            <div className="stack gap-sm">
              <div className="actions inline">
                <span className="tag">{cfg.oauth?.status || "未連線"}</span>
                {cfg.oauth?.tokenPreview ? <span className="tag subtle">{cfg.oauth.tokenPreview}</span> : null}
                <button className="btn" type="button" onClick={() => void exchangeShortToken()} disabled={oauthBusy || !shortToken.trim()}>交換長效 token</button>
                <button className="btn danger" type="button" onClick={() => void disconnectMeta()} disabled={oauthBusy || !cfg.tokenStatus?.user}>中斷授權</button>
              </div>
              <div className="hint">Meta 使用者：{cfg.oauth?.metaUserName || cfg.oauth?.metaUserId || "未取得"}</div>
              <div className="hint">Token 到期：{formatDateTime(cfg.oauth?.expiresAt)}</div>
              <div className="hint">資料存取到期：{formatDateTime(cfg.oauth?.dataAccessExpiresAt)}</div>
              <div className="hint">Scopes：{cfg.oauth?.scopes?.length ? cfg.oauth.scopes.join("、") : "尚未取得"}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="sep" />

      <div className="meta-account-picker">
        <div className="meta-account-picker-head">
          <div>
            <div className="dense-title">Meta 帳戶選擇</div>
            <p className="dense-meta">使用已儲存的 User Key 讀取可管理的廣告帳號、粉專與 Instagram 帳戶，避免手動輸入錯誤 ID。</p>
          </div>
          <button className="btn" type="button" onClick={() => void loadAccounts()} disabled={accountsLoading}>
            {accountsLoading ? "載入中..." : "載入 Meta 帳戶"}
          </button>
        </div>
        <div className="row cols2">
          <label className="field">
            <div className="label">預設廣告帳號</div>
            <select value={selectedAdAccountId} onChange={(event) => selectAdAccount(event.target.value)}>
              <option value="">請選擇廣告帳號</option>
              {adAccounts.map((account) => <option key={account.id} value={account.id}>{optionLabelForAdAccount(account)}</option>)}
            </select>
            <div className="hint">{selectedAdAccount ? `已選擇：${selectedAdAccount.name || selectedAdAccount.id} / act_${selectedAdAccount.id}` : "建立投放前必須選擇。"}</div>
          </label>
          <label className="field">
            <div className="label">Facebook 粉絲專頁</div>
            <select value={selectedPageId} onChange={(event) => selectPage(event.target.value)}>
              <option value="">請選擇粉專</option>
              {pages.map((page) => <option key={page.id} value={page.id}>{optionLabelForPage(page)}</option>)}
            </select>
            <div className="hint">{selectedPage ? `已選擇：${selectedPage.name} / ${selectedPage.id}` : "可先載入清單，也可在下方手動輸入。"}</div>
          </label>
          <label className="field">
            <div className="label">Instagram 帳戶</div>
            <select value={selectedInstagramId} onChange={(event) => selectInstagram(event.target.value)}>
              <option value="">請選擇 Instagram 帳戶</option>
              {instagramAccounts.map((account) => <option key={account.id} value={account.id}>{optionLabelForInstagram(account)}</option>)}
            </select>
            <div className="hint">{selectedInstagram ? `已選擇：${selectedInstagram.username || selectedInstagram.id}` : "若粉專有連結 IG，選粉專時會自動帶入。"}</div>
          </label>
        </div>
        {accountsFetchedAt ? <div className="hint">最近載入時間：{formatDateTime(accountsFetchedAt)}</div> : null}
      </div>

      <div className="row cols2">
        <label className="field">
          <div className="label">Facebook 粉專 ID</div>
          <input value={cfg.pageId} onChange={(event) => setCfg({ ...cfg, pageId: event.target.value.trim() })} />
        </label>
        <label className="field">
          <div className="label">Facebook 粉專名稱</div>
          <input value={cfg.pageName} onChange={(event) => setCfg({ ...cfg, pageName: event.target.value.trim() })} />
        </label>
        <label className="field">
          <div className="label">Instagram Actor ID</div>
          <input value={cfg.instagramActorId} onChange={(event) => setCfg({ ...cfg, instagramActorId: event.target.value.trim() })} />
        </label>
      </div>

      <div className="sep" />

      <div className="stack gap-sm">
        {TOKEN_SCOPES.map(({ scope, label, desc }) => (
          <div className="token-setting-row" key={scope}>
            <label className="field token-field">
              <div className="label">{label}</div>
              <input
                type="password"
                value={tokens[scope]}
                onChange={(event) => setTokens((state) => ({ ...state, [scope]: event.target.value.trim() }))}
                placeholder="貼上新的 Key 後可驗證並儲存"
              />
              <div className="hint">{desc}</div>
            </label>
            <div className="field token-status-field">
              <div className="label">狀態</div>
              <div className="actions inline">
                <span className="tag">{statusText(cfg, scope)}</span>
                {scope !== "user" && <span className="tag subtle">{sourceText(cfg, scope)}</span>}
                <button className="btn" type="button" onClick={() => void verify(scope)} disabled={verifying[scope]}>
                  {verifying[scope] ? "驗證中..." : "驗證"}
                </button>
                <button className="btn danger" type="button" onClick={() => void clearToken(scope)} disabled={saving || !cfg.tokenStatus?.[scope]}>
                  清除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="actions inline">
        <button className="btn primary" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "儲存中..." : "儲存 Meta 設定"}
        </button>
      </div>
    </CollapsibleCard>
  );
}
