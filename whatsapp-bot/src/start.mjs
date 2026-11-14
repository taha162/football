import { chownSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The container's entry point. Hosting platforms mount the volume owned by
 * root, so the container starts as root only to give the data folder to the
 * "node" user (uid 1000 in the official image), then runs the bot as that
 * user. Outside a container (not root) it just starts the bot.
 */
const NODE_UID = 1000;
const NODE_GID = 1000;

/** @param {string} path */
function chownTree(path) {
  chownSync(path, NODE_UID, NODE_GID);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) chownTree(child);
    else chownSync(child, NODE_UID, NODE_GID);
  }
}

if (typeof process.getuid === "function" && process.getuid() === 0) {
  const dir = process.env.DATA_DIR || "/data";
  mkdirSync(dir, { recursive: true });
  chownTree(dir);
  process.setgroups?.([NODE_GID]);
  process.setgid?.(NODE_GID);
  process.setuid?.(NODE_UID);
}

await import("./index.mjs");
