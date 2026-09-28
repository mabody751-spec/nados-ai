import test from 'node:test'
import assert from 'node:assert/strict'
import { sniffKind, validateUploads } from './uploads.mjs'

const buf = (bytes) => Buffer.from(bytes)

test('sniffs common file signatures', () => {
  assert.equal(sniffKind(buf([0xff, 0xd8, 0xff, 0xe0])), 'jpeg')
  assert.equal(sniffKind(buf([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'png')
  assert.equal(sniffKind(buf([0x25, 0x50, 0x44, 0x46, 0x2d])), 'pdf')
  assert.equal(sniffKind(buf([0x50, 0x4b, 0x03, 0x04, 0x14])), 'zip')
  assert.equal(sniffKind(buf([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])), 'mp4')
  assert.equal(sniffKind(Buffer.from('hello world')), 'unknown')
})

test('accepts a real PNG image', () => {
  const error = validateUploads([{ originalname: 'a.png', mimetype: 'image/png', buffer: buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]) }])
  assert.equal(error, null)
})

test('rejects an image whose content is not an image', () => {
  const error = validateUploads([{ originalname: 'fake.png', mimetype: 'image/png', buffer: Buffer.from('<script>alert(1)</script>') }])
  assert.match(String(error), /غير صالح|متنكّر/)
})

test('rejects disallowed MIME types', () => {
  const error = validateUploads([{ originalname: 'evil.exe', mimetype: 'application/x-msdownload', buffer: buf([0x4d, 0x5a]) }])
  assert.match(String(error), /غير مسموح/)
})

test('accepts a real PDF and rejects a fake one', () => {
  assert.equal(validateUploads([{ originalname: 'doc.pdf', mimetype: 'application/pdf', buffer: buf([0x25, 0x50, 0x44, 0x46, 0x2d]) }]), null)
  assert.match(String(validateUploads([{ originalname: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a pdf') }])), /PDF غير صالح/)
})

test('accepts a DOCX (zip container) and rejects a fake one', () => {
  assert.equal(validateUploads([{ originalname: 'a.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: buf([0x50, 0x4b, 0x03, 0x04]) }]), null)
  assert.match(String(validateUploads([{ originalname: 'a.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('plain') }])), /Office غير صالح/)
})
