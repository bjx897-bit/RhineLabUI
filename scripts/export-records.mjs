import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  loadContent,
  validateContent,
  archiveText,
} from "./archive-content.mjs";

export async function exportRecords(content, output) {
  // Validate the entire input before creating, writing or removing any files.
  const { records } = validateContent(content);
  await fs.mkdir(output, { recursive: true });
  const filenames = new Set();
  for (const record of records) {
    const filename = "RHINE-LAB-" + record.id + ".txt";
    filenames.add(filename);
    await fs.writeFile(join(output, filename), archiveText(record), "utf8");
  }
  // Removed archives must not remain downloadable or enter the PWA cache.
  // Only this generator's exact filename pattern is managed here.
  for (const entry of await fs.readdir(output, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      /^RHINE-LAB-X-\d{3}\.txt$/.test(entry.name) &&
      !filenames.has(entry.name)
    ) {
      await fs.unlink(join(output, entry.name));
    }
  }
  return records.length;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const count = await exportRecords(
    await loadContent(),
    fileURLToPath(new URL("../public/archives/", import.meta.url)),
  );
  console.log("Prepared " + count + " downloadable archive records.");
}
