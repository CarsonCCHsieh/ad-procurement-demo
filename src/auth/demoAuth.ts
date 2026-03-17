export type DemoUserRole = "admin" | "order_user";

export type DemoUser = {
  username: string;
  password: string;
  displayName: string;
  role: DemoUserRole;
};

export const DEMO_USERS: DemoUser[] = [
  {
    username: "demo",
    password: "demo1234",
    displayName: "測試使用者",
    role: "admin",
  },
  {
    username: "order",
    password: "order1234",
    displayName: "下單使用者",
    role: "order_user",
  },
];

export function findDemoUser(username: string, password: string): DemoUser | null {
  const normalized = username.trim();
  return DEMO_USERS.find((user) => user.username === normalized && user.password === password) ?? null;
}
