import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { signIn } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const from = useMemo(() => {
    const state = loc.state as { from?: string } | null;
    return typeof state?.from === "string" ? state.from : "/ad-orders";
  }, [loc.state]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = signIn(username.trim(), password);
    if (!result.ok) {
      setError(result.message ?? "登入失敗");
      return;
    }
    nav(from, { replace: true });
  };

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">廣告下單系統</div>
          <div className="brand-sub">登入後即可使用下單與進度查看功能。</div>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-title">登入</div>
            <div className="card-desc">請使用管理員或下單帳號登入。</div>
          </div>
        </div>
        <div className="card-bd">
          <form onSubmit={onSubmit} className="grid">
            <div className="row cols2">
              <div className="field">
                <div className="label">
                  帳號<span className="req">*</span>
                </div>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="請輸入帳號" />
              </div>
              <div className="field">
                <div className="label">
                  密碼<span className="req">*</span>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="請輸入密碼"
                />
              </div>
            </div>

            {error && <div className="error">{error}</div>}

            <div className="actions">
              <button className="btn primary" type="submit">
                登入
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
