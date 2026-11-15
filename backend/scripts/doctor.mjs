import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let failed = false;
try {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  const metadata = await sharp(bytes).metadata();
  if (metadata.width !== 2) throw Error('Decode failed');
  console.log(
    `Sharp ${sharp.versions.sharp}: native encode/decode passed (${process.platform}-${process.arch}).`,
  );
  console.log('Module location: ' + require.resolve('sharp'));
} catch {
  failed = true;
  console.error('Sharp could not load its native binary. From the backend folder run:');
  console.error(
    process.platform === 'win32'
      ? 'npm install --include=optional --os=win32 --cpu=x64 sharp@0.35.5'
      : 'npm install --include=optional sharp@0.35.5',
  );
  console.error('Then run npm run doctor again. See README.md for a clean reinstall.');
}
process.exitCode = failed ? 1 : 0;
