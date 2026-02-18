import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function AdPerformancePage() {
  const nav = useNavigate();
  const { user, signOut } = useAuth();

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="brand-title">投放成效（Demo 占位）</div>
          <div className="brand-sub">之後會顯示進度與成效指標</div>
        </div>
        <div className="pill">
          <span className="tag">{user?.displayName ?? user?.username}</span>
          <button className="btn" onClick={() => nav("/ad-orders")}>
            回下單
          </button>
          <button
            className="btn danger"
            onClick={() => {
              signOut();
              nav("/login", { replace: true });
            }}
          >
            登出
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-title">成效/進度</div>
            <div className="card-desc">目前先做到下單流程，成效頁後續再接 API。</div>
          </div>
          <span className="tag">#/ad-performance</span>
        </div>
        <div className="card-bd">
          <div className="hint">TODO: 讀取工單清單、顯示狀態、顯示成效指標。</div>
        </div>
      </div>
    </div>
  );
}

