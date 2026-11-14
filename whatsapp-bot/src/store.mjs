import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * A JSON file on the volume, written atomically (a temporary file, then a
 * rename), so a crash mid-write never leaves half a file.
 * @param {string} file
 */
export function jsonFile(file) {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (e) {
        if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return null;
        throw e;
      }
    },
    /** @param {unknown} data */
    async save(data) {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, file);
    },
  };
}

/** Keeps nothing: for tests and for a bot started without a volume. */
export function memoryStore(initial = null) {
  let data = initial;
  return {
    async load() {
      return data;
    },
    async save(next) {
      data = JSON.parse(JSON.stringify(next));
    },
    peek: () => data,
  };
}
