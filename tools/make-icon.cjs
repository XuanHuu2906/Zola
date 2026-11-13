const { copyFile, mkdir } = require('node:fs/promises');
const path = require('node:path');

// Use the supplied artwork and its prepared size variants without redrawing it.
const source = path.resolve(__dirname, '../logo/Z_App_Icon_Pack');
const target = path.resolve(__dirname, '../build');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

(async () => {
  await mkdir(path.join(target, 'icons'), { recursive: true });
  await copyFile(path.join(source, 'z-app.png'), path.join(target, 'icon.png'));
  await copyFile(path.join(source, 'z-app.ico'), path.join(target, 'icon.ico'));
  await copyFile(path.join(source, 'z-app.icns'), path.join(target, 'icon.icns'));
  for (const size of sizes) {
    await copyFile(path.join(source, 'png', `z-app-${size}.png`), path.join(target, 'icons', `${size}x${size}.png`));
  }
  console.log(`Copied Zola artwork and ${sizes.length} icon sizes from logo/Z_App_Icon_Pack`);
})().catch(error => { console.error(error); process.exitCode = 1; });
