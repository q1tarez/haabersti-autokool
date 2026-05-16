const fs = require("fs");

async function uploadImageBuffer({ buffer, filename, contentType }) {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  if (token) {
    const { put } = require("@vercel/blob");
    const blob = await put(filename, buffer, {
      access: "public",
      token,
      contentType: contentType || "application/octet-stream",
    });
    return { ok: true, path: blob.url, storage: "blob" };
  }
  return null;
}

async function uploadImageFromDisk({ filePath, filename, contentType }) {
  const buf = await fs.promises.readFile(filePath);
  return uploadImageBuffer({ buffer: buf, filename, contentType });
}

module.exports = { uploadImageBuffer, uploadImageFromDisk };
