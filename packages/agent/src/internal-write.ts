import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export async function atomicWritePublic(
  path: string,
  data: string,
  overwrite = true,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, data, { encoding: "utf8", flag: "wx" });
  if (!overwrite) {
    try {
      await link(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return;
  }
  await rename(temporary, path).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST" && error.code !== "EPERM") throw error;
    await rm(path, { force: true });
    await rename(temporary, path);
  });
}
