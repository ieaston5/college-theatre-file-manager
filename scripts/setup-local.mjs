import fs from "node:fs";
import crypto from "node:crypto";

if (!fs.existsSync(".env")) {
  const contents = fs.readFileSync(".env.example", "utf8")
    .replace('SESSION_SECRET=""', `SESSION_SECRET="${crypto.randomBytes(48).toString("base64")}"`)
    .replace('APP_ENCRYPTION_KEY=""', `APP_ENCRYPTION_KEY="${crypto.randomBytes(32).toString("base64")}"`);
  fs.writeFileSync(".env", contents, { flag: "wx", mode: 0o600 });
  console.log("Created local configuration. PostgreSQL must be running; use docker compose up -d db.");
} else {
  console.log("Using the existing configuration without changes.");
}
