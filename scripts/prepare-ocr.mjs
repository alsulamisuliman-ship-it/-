import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const destination = path.resolve(".ocr-models");
const revision = "87416418657359cb625c412a48b6e1d6d41c29bd";
const hashes = {
  ara: "e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729",
  eng: "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
};
await mkdir(destination, { recursive: true });
for (const [language, hash] of Object.entries(hashes)) {
  const file = path.join(destination, `${language}.traineddata`);
  let data;
  try {
    data = await readFile(file);
  } catch {}
  const valid = value =>
    value && createHash("sha256").update(value).digest("hex") === hash;
  if (!valid(data)) {
    const response = await fetch(
      `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${revision}/${language}.traineddata`,
      { signal: AbortSignal.timeout(60000) }
    );
    if (!response.ok)
      throw new Error(
        `Could not download ${language} OCR model: ${response.status}`
      );
    data = Buffer.from(await response.arrayBuffer());
    if (!valid(data))
      throw new Error(`OCR model checksum mismatch: ${language}`);
    await writeFile(file, data);
  }
  console.log(`Verified local OCR model: ${language}`);
}
