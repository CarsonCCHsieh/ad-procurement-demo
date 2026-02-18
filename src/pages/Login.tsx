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
    const state = loc.state as any;
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
          <div className="brand-title">廣告採購 Demo</div>
          <div className="brand-sub">GitHub Pages 預覽用（假登入）</div>
        </div>
        <span className="tag">#/login</span>
      </div>

      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-title">登入</div>
            <div className="card-desc">這不是安全機制，只用於 demo 門檻。</div>
          </div>
        </div>
        <div className="card-bd">
          <form onSubmit={onSubmit} className="grid">
            <div className="row cols2">
              <div className="field">
                <div className="label">
                  帳號<span className="req">*</span>
                </div>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="demo" />
              </div>
              <div className="field">
                <div className="label">
                  密碼<span className="req">*</span>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="demo1234"
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

