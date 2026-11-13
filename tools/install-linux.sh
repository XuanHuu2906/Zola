#!/usr/bin/env bash
# Install the built AppImage for the current user.
#
# Fedora does not ship libfuse2 (`fuse-libs` is FUSE 2.x, but the AppImage runtime
# needs the 2.x shared object which Fedora's package no longer provides in a
# discoverable path), so a plain AppImage fails with
# "dlopen(): error loading libfuse.so.2". Rather than ask for root to install a
# legacy library, this extracts the AppImage once into ~/.local/opt and runs the
# extracted tree directly — the same layout the AppImage would mount at runtime,
# just persistent.
#
# Usage: tools/install-linux.sh [path/to/AppImage]
set -euo pipefail

cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
appimage=${1:-"release/Zola-${version}-x86_64.AppImage"}
opt_dir="$HOME/.local/opt/glass-messenger"
bin_dir="$HOME/.local/bin"
desktop_dir="$HOME/.local/share/applications"
icon_dir="$HOME/.local/share/icons/hicolor/256x256/apps"

if [ ! -f "$appimage" ]; then
  echo "AppImage not found: $appimage" >&2
  echo "Build it first with: npm run build:desktop" >&2
  exit 1
fi

echo "Extracting $appimage"
rm -rf "$opt_dir"
mkdir -p "$opt_dir"
"$appimage" --appimage-extract >/dev/null
mv squashfs-root/* "$opt_dir"/
rm -rf squashfs-root

mkdir -p "$bin_dir" "$desktop_dir" "$icon_dir"
rm -f "$bin_dir/glass-messenger-demo" "$desktop_dir/glass-messenger-demo.desktop" "$icon_dir/glass-messenger-demo.png"
for size in 16 24 32 48 64 128 256 512; do
  size_dir="$HOME/.local/share/icons/hicolor/${size}x${size}/apps"
  mkdir -p "$size_dir"
  cp "build/icons/${size}x${size}.png" "$size_dir/zola.png"
done
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
fi

# AppRun is the entry point the AppImage itself would use.
cat > "$bin_dir/zola" <<EOF
#!/usr/bin/env bash
exec "$opt_dir/AppRun" "\$@"
EOF
chmod +x "$bin_dir/zola"

cat > "$desktop_dir/zola.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Zola
Comment=Zalo desktop client
Exec=$bin_dir/zola %U
Icon=zola
Terminal=false
Categories=Network;InstantMessaging;
EOF

update-desktop-database "$desktop_dir" 2>/dev/null || true

echo "Installed to $opt_dir"
echo "  launcher: $bin_dir/zola"
echo "  desktop:  $desktop_dir/zola.desktop"
echo "Run it with: zola"
