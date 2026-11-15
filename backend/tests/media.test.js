import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1/unused_image_test',
  APP_ORIGIN: 'http://localhost:5173',
  RP_ID: 'localhost',
  SESSION_SECRET: 'image-test-secret-at-least-32-characters',
  ENCRYPTION_KEY: '2'.repeat(64),
  SETUP_KEY: 'image-test-setup-key',
});
const { saveMedia } = await import('../services/media.js');

for (const format of ['jpeg', 'png', 'webp']) {
  test(`native Sharp encodes and fully decodes ${format}`, async () => {
    const bytes = await sharp({
      create: { width: 16, height: 12, channels: 3, background: '#284657' },
    })
      .toFormat(format)
      .toBuffer();
    const decoded = sharp(bytes, { limitInputPixels: 20000000 });
    const metadata = await decoded.metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 16);
    assert.equal(metadata.height, 12);
    assert.equal((await decoded.stats()).channels.length, 3);
  });
}

test('upload rejects invalid or truncated image bytes before accessing MongoDB', async () => {
  const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  for (const bytes of [Buffer.from('not an image'), png.subarray(0, 45)]) {
    await assert.rejects(saveMedia(bytes, 'unused', 'signature', 'upload'), (error) => {
      assert.equal(error.status, 400);
      return true;
    });
  }
});

test('upload rejects decoded formats outside the allowed JPG, PNG and WebP list', async () => {
  const gif = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } })
    .gif()
    .toBuffer();
  await assert.rejects(saveMedia(gif, 'unused', 'signature', 'upload'), /Unsupported image format/);
});
