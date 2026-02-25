import { createUpdaterApp } from "./app.js";
import { resolveUpdaterRuntimeConfig } from "./config.js";

const config = resolveUpdaterRuntimeConfig(process.env);
const app = createUpdaterApp(config);

app.listen(config.port, () => {
  console.log(`FyreFlow updater listening on http://localhost:${config.port}`);
});
