import { writeFile } from "node:fs/promises";

if (process.env.RR_PID_FILE) {
  await writeFile(process.env.RR_PID_FILE, String(process.pid), "utf8");
}
setInterval(() => undefined, 1_000);
