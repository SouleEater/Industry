#!/usr/bin/env bash
# Резервная копия базы «Индустрии» из работающего контейнера. Хранит 14 последних копий.
#   bash scripts/backup.sh [каталог для копий, по умолчанию ~/backups]
# Раз в сутки, например: (crontab -e)  17 4 * * *  cd ~/Industry && bash scripts/backup.sh >> ~/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${1:-$HOME/backups}"
mkdir -p "$DEST"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
STAMP=$(date +%F-%H%M)
# VACUUM INTO делает согласованную копию даже во время игры.
$DOCKER compose exec -T app node -e "
  const { DatabaseSync } = require('node:sqlite');
  try { require('node:fs').unlinkSync('/data/backup.db'); } catch {}
  new DatabaseSync('/data/industry.db').exec(\"VACUUM INTO '/data/backup.db'\");"
$DOCKER compose cp app:/data/backup.db "$DEST/industry-$STAMP.db"
chmod 600 "$DEST/industry-$STAMP.db"
ls -1t "$DEST"/industry-*.db | tail -n +15 | xargs -r rm --
echo "Копия сохранена: $DEST/industry-$STAMP.db"
