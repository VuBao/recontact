export const MAX_ATTACHMENT_COUNT = 3;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_COMBINED_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function sanitizeFilename(name) {
  if (!name || typeof name !== "string") return "attachment.pdf";
  // Remove directory traversals and path separators
  let base = name.split(/[/\\]/).pop().trim();
  // Replace invalid characters with underscore, keeping letters, numbers, dot, dash, underscore, and space
  base = base.replace(/[^\p{L}\p{N}._\s-]/gu, "_").trim();
  if (!/\.pdf$/i.test(base)) {
    base = `${base}.pdf`;
  }
  return base.slice(-120);
}

export function isPdfMagicBytes(buffer) {
  if (!buffer || buffer.byteLength < 5) return false;
  const header = new Uint8Array(buffer.slice(0, 5));
  // %PDF- => 0x25, 0x50, 0x44, 0x46, 0x2D
  return (
    header[0] === 0x25 &&
    header[1] === 0x50 &&
    header[2] === 0x44 &&
    header[3] === 0x46 &&
    header[4] === 0x2d
  );
}

export async function validateAttachments(files) {
  if (!files || !files.length) return [];

  if (files.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`Maximum ${MAX_ATTACHMENT_COUNT} attachments allowed per batch.`);
  }

  let totalSize = 0;
  const seenNames = new Set();
  const validated = [];

  for (const file of files) {
    if (!file || typeof file.arrayBuffer !== "function") {
      throw new Error("Invalid attachment object.");
    }

    if (!/\.pdf$/i.test(file.name)) {
      throw new Error(`Attachment "${file.name}" must be a PDF file.`);
    }

    if (file.type && file.type !== "application/pdf") {
      throw new Error(`Attachment "${file.name}" declared invalid MIME type "${file.type}". Expected application/pdf.`);
    }

    if (file.size <= 0) {
      throw new Error(`Attachment "${file.name}" is empty.`);
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`Attachment "${file.name}" exceeds maximum allowed size of 5 MB.`);
    }

    totalSize += file.size;
    if (totalSize > MAX_COMBINED_SIZE_BYTES) {
      throw new Error("Combined attachments exceed maximum allowed size of 10 MB.");
    }

    const sanitizedName = sanitizeFilename(file.name);
    const lowerName = sanitizedName.toLowerCase();
    if (seenNames.has(lowerName)) {
      throw new Error(`Duplicate attachment filename detected: "${file.name}".`);
    }
    seenNames.add(lowerName);

    const buffer = await file.arrayBuffer();
    if (!isPdfMagicBytes(buffer)) {
      throw new Error(`Attachment "${file.name}" is not a valid PDF file (corrupted or invalid magic bytes).`);
    }

    validated.push({
      filename: sanitizedName,
      contentType: "application/pdf",
      bytes: buffer
    });
  }

  return validated;
}
