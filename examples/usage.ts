import LangfusePlugin from "../src/plugin.js";

// Cordis resolves this configuration through LangfusePlugin.Config.
export const langfuseConfig = {
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: "https://cloud.langfuse.com",
  environment: "development",
  capturePrompts: true,
};

export { LangfusePlugin };
