#!/usr/bin/env bash
# Первичная настройка чистой Ubuntu-машины (например, Oracle Cloud Always Free) для «Индустрии».
#   bash scripts/vm-setup.sh <домен> [регистрация: invite|open|closed]
# Делает: ставит Docker, добавляет swap на слабых машинах, открывает порты 80/443 в файрволе
# ВМ, создаёт .env (секрет и код приглашения генерируются случайно) и запускает сервер.
# Безопасно запускать повторно: существующий .env не перезаписывается.
set -euo pipefail

DOMAIN="${1:-}"
REGISTRATION="${2:-invite}"
if [[ -z "$DOMAIN" ]]; then
  echo "Использование: bash scripts/vm-setup.sh <домен> [invite|open|closed]" >&2
  echo "Пример:        bash scripts/vm-setup.sh myindustry.duckdns.org" >&2
  exit 2
fi
case "$REGISTRATION" in invite|open|closed) ;; *) echo "Режим регистрации: invite, open или closed" >&2; exit 2 ;; esac

cd "$(dirname "$0")/.."

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

echo "==> Swap (сборка образа на 1 ГБ памяти без него падает)"
MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if (( MEM_MB < 2500 )) && [[ ! -f /swapfile ]]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Файрвол ВМ: порты 80 и 443"
# На образах Ubuntu от Oracle входящие соединения режет iptables; правила кладём выше REJECT.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
if ! dpkg -s netfilter-persistent >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null
fi
sudo netfilter-persistent save >/dev/null 2>&1 || true

echo "==> Настройки (.env)"
if [[ -f .env ]]; then
  echo ".env уже есть, оставляю как есть"
else
  SECRET=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')
  INVITE=$(head -c 9 /dev/urandom | base64 | tr -d '/+=' | head -c 12)
  {
    echo "DOMAIN=$DOMAIN"
    echo "SESSION_SECRET=$SECRET"
    echo "REGISTRATION=$REGISTRATION"
    echo "INVITE_CODE=$INVITE"
    echo "MAX_USERS=100"
  } > .env
  chmod 600 .env
  echo "Создан .env. Код приглашения для друзей: $INVITE"
fi

echo "==> Сборка и запуск (первый раз занимает несколько минут)"
$DOCKER compose up -d --build

echo
echo "Готово. Через минуту откройте https://$DOMAIN"
echo "Логи:        $DOCKER compose logs -f app"
echo "Код приглашения лежит в файле .env (строка INVITE_CODE)."
echo "Если Docker только что установлен, перелогиньтесь в SSH, чтобы команды docker работали без sudo."
