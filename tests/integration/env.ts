// Runs in every integration worker before tests import app code.
import { testUrls } from "./test-db";

const urls = testUrls();
process.env.DATABASE_OWNER_URL = urls.owner;
process.env.DATABASE_URL = urls.app;
process.env.PLATFORM_DATABASE_URL = urls.platform;
process.env.PROVISIONER_DATABASE_URL = urls.provisioner;

// Messaging: a throwaway key for encrypted secrets, and never call Meta.
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.WHATSAPP_DRIVER = "log";
