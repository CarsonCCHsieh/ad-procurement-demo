// Demo-only credentials.
//
// IMPORTANT:
// - This is NOT secure. Anything in a static site can be inspected.
// - This is only meant to prevent accidental access during demos.

export type DemoUser = {
  username: string;
  password: string;
  displayName: string;
};

export const DEMO_USER: DemoUser = {
  username: "demo",
  password: "demo1234",
  displayName: "Demo User",
};

