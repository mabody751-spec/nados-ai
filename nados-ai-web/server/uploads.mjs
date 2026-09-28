// Upload hardening: only allow expected MIME families, and verify the real file
// signature (magic bytes) for images/PDF/office/video so a renamed file cannot
// smuggle an unexpected payload through the chat upload path.

const ALLOWED = [
  /^image\//,
  /^video\//,
  /^text\//,
  /^application\/json$/,
  /^application\/xml$/,
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^application\/vnd\.ms-(excel|powerpoint)$/,
  /^application\/csv$/,
]

function startsWith(buffer, bytes) {
  if (!buffer || buffer.length < bytes.length) return false
  return bytes.every((b, i) => buffer[i] === b)
}

export function sniffKind(buffer) {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && buffer.length > 11 && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return 'pdf'
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return 'zip'
  if (buffer.length >= 8 && buffer.slice(4, 8).toString('ascii') === 'ftyp') return 'mp4'
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm'
  return 'unknown'
}

/**
 * @param {Array<{originalname?:string,mimetype?:string,buffer?:Buffer,size?:number}>} files
 * @returns {string|null} error message in Arabic, or null when all files are valid
 */
export function validateUploads(files = []) {
  const list = Array.isArray(files) ? files : []
  for (const file of list) {
    const mime = String(file?.mimetype || '')
    const name = String(file?.originalname || 'ملف')
    if (!ALLOWED.some((pattern) => pattern.test(mime))) {
      return `نوع الملف غير مسموح: ${name} (${mime || 'غير معروف'}).`
    }
    const kind = sniffKind(file?.buffer)
    if (mime.startsWith('image/')) {
      const ok = ['jpeg', 'png', 'gif', 'webp'].includes(kind) || (mime === 'image/jpeg' && kind === 'jpeg')
      if (!ok) return `محتوى الصورة غير صالح أو متنكّر: ${name}.`
    }
    if (mime === 'application/pdf' && kind !== 'pdf') return `ملف PDF غير صالح: ${name}.`
    if (/vnd\.openxmlformats-officedocument/.test(mime) && kind !== 'zip') return `ملف Office غير صالح: ${name}.`
    if (mime.startsWith('video/') && !['mp4', 'webm', 'unknown'].includes(kind)) return `ملف الفيديو غير صالح: ${name}.`
  }
  return null
}
