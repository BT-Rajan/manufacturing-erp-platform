import { createApp } from "./api/app.js";
import { getSettings } from "./core/config/settings.js";
import { logger } from "./core/logging/logger.js";

const settings = getSettings();
const app = createApp();

app.listen(settings.port, () => {
  logger.info(`${settings.appName} listening on port ${settings.port} (env=${settings.env})`);
});
