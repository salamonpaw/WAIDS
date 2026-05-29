# Weryfikator Abonamentów — Instrukcja wdrożenia

## Spis treści
1. [Stack technologiczny](#1-stack-technologiczny)
2. [Architektura aplikacji](#2-architektura-aplikacji)
3. [Wymagania serwerowe](#3-wymagania-serwerowe)
4. [Wdrożenie na Debianie (krok po kroku)](#4-wdrożenie-na-debianie)
5. [Konfiguracja zmiennych środowiskowych](#5-konfiguracja-zmiennych-środowiskowych)
6. [Konfiguracja nginx](#6-konfiguracja-nginx)
7. [Systemd — backend jako usługa](#7-systemd--backend-jako-usługa)
8. [Backup bazy danych](#8-backup-bazy-danych)
9. [Aktualizacja aplikacji](#9-aktualizacja-aplikacji)
10. [Rozwiązywanie problemów](#10-rozwiązywanie-problemów)

---

## 1. Stack technologiczny

| Warstwa       | Technologia                         | Wersja minimalna | Uwagi                                     |
|---------------|-------------------------------------|-----------------|-------------------------------------------|
| Frontend      | HTML/CSS/JavaScript (vanilla)       | —               | Jeden plik `index.html`, zero zależności npm do działania |
| Serwer HTTP   | nginx                               | 1.18+           | Serwuje frontend + proxy do backendu       |
| Backend API   | Python + FastAPI + Uvicorn          | Python 3.9+     | REST API, port 8001                        |
| Baza danych   | PostgreSQL                          | 14+             | Port 5432, baza `abonaments`               |
| ORM / driver  | psycopg2-binary                     | 2.9+            | Bezpośredni SQL, brak ORM                 |
| Parsowanie plików | pandas + openpyxl + odfpy       | pandas 2.2+     | Import .xlsx, .xls, .ods                  |

### Biblioteki Pythona (backend/requirements.txt)
```
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
pandas>=2.2.0
openpyxl>=3.1.2        # obsługa .xlsx
odfpy>=1.4.1           # obsługa .ods
python-multipart>=0.0.9
psycopg2-binary>=2.9.9
python-dotenv>=1.0.0
```

### Pliki projektu
```
subscription-checker/
├── index.html              ← cała aplikacja frontendowa (1 plik)
├── backend/
│   ├── main.py             ← FastAPI endpoints
│   ├── database.py         ← warstwa dostępu do PostgreSQL
│   ├── requirements.txt    ← zależności Pythona
│   └── .env                ← zmienne środowiskowe (DATABASE_URL)
├── docker-compose.yml      ← opcjonalnie: baza w Dockerze
└── DEPLOYMENT.md           ← ten plik
```

---

## 2. Architektura aplikacji

```
Przeglądarka
    │  HTTP na port 80 (lub 443 z SSL)
    ▼
┌─────────────────────────────────────────────────────┐
│                      nginx                          │
│  /          → serwuje index.html (statyczny plik)   │
│  /api/      → proxy_pass http://127.0.0.1:8001/     │
└─────────────────────────────────────────────────────┘
                          │
                          │ HTTP localhost:8001
                          ▼
┌─────────────────────────────────────────────────────┐
│            FastAPI + Uvicorn (Python)               │
│            Procesy robocze: 2–4 (workers)           │
│            Plik: backend/main.py                    │
└─────────────────────────────────────────────────────┘
                          │
                          │ psycopg2 (TCP localhost:5432)
                          ▼
┌─────────────────────────────────────────────────────┐
│                   PostgreSQL 16                     │
│            Baza: abonaments                         │
│            Użytkownik: asd                          │
└─────────────────────────────────────────────────────┘
```

> **Ważne:** Backend używa CORS `allow_origins=["*"]`. Jeśli aplikacja ma być dostępna publicznie, w `main.py` zmień na konkretną domenę, np. `["https://twoja-domena.pl"]`.

---

## 3. Wymagania serwerowe

### Minimalne
- Debian 11 (Bullseye) lub Debian 12 (Bookworm) — **zalecane Bookworm**
- CPU: 1 vCPU
- RAM: 1 GB (PostgreSQL + Python + nginx)
- Dysk: 5 GB (aplikacja + dane + logi)

### Zalecane (przy dużej bazie urządzeń)
- 2 vCPU
- 2 GB RAM
- 20 GB dysk (miejsce na pliki importowane i backupy)

### Porty sieciowe do otwarcia
| Port | Protokół | Opis                          |
|------|----------|-------------------------------|
| 22   | TCP      | SSH                           |
| 80   | TCP      | HTTP (nginx)                  |
| 443  | TCP      | HTTPS (nginx + certbot/SSL)   |
| 5432 | TCP      | PostgreSQL — **tylko localhost**, NIE otwierać na zewnątrz |
| 8001 | TCP      | Backend API — **tylko localhost**, obsługiwany przez nginx  |

---

## 4. Wdrożenie na Debianie

### 4.1 Przygotowanie systemu

```bash
sudo apt update && sudo apt upgrade -y

# Podstawowe narzędzia
sudo apt install -y git curl wget unzip nginx postgresql postgresql-contrib \
    python3 python3-pip python3-venv python3-dev libpq-dev build-essential \
    ufw
```

### 4.2 Konfiguracja PostgreSQL

```bash
# Wejdź jako użytkownik postgres
sudo -u postgres psql

-- W psql:
CREATE USER asd WITH PASSWORD 'zmien_to_haslo_na_silne';
CREATE DATABASE abonaments OWNER asd;
\q
```

```bash
# Weryfikacja połączenia
psql -h localhost -U asd -d abonaments -c "SELECT version();"
```

> **Ważne:** Tabele (`devices`, `payments`, `excluded_firms`, `sales_reps`, `firm_reps`) tworzone są automatycznie przy pierwszym uruchomieniu backendu przez funkcję `init_db()` — nie musisz ich tworzyć ręcznie.

### 4.3 Konto systemowe dla aplikacji

```bash
# Dedykowany użytkownik bez powłoki (bezpieczeństwo)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin abonaments
```

### 4.4 Kopiowanie plików aplikacji

```bash
# Utwórz katalog aplikacji
sudo mkdir -p /opt/abonaments
sudo chown abonaments:abonaments /opt/abonaments

# Skopiuj pliki (z lokalnego komputera przez scp lub rsync)
# Z lokalnego komputera (Mac/Windows):
scp -r "/Users/pawel/IDS Wyliczenia/subscription-checker/" user@TWÓJ_SERWER:/opt/abonaments/

# LUB na serwerze — sklonuj z gita jeśli masz repozytorium:
# sudo -u abonaments git clone https://twoje-repo.git /opt/abonaments/app
```

Struktura na serwerze:
```
/opt/abonaments/
└── subscription-checker/
    ├── index.html
    ├── backend/
    │   ├── main.py
    │   ├── database.py
    │   ├── requirements.txt
    │   └── .env
    └── ...
```

### 4.5 Środowisko wirtualne Pythona

```bash
cd /opt/abonaments/subscription-checker/backend

# Utwórz i aktywuj virtualenv
python3 -m venv venv
source venv/bin/activate

# Zainstaluj zależności
pip install --upgrade pip
pip install -r requirements.txt

deactivate
```

### 4.6 Plik .env (konfiguracja backendu)

```bash
sudo nano /opt/abonaments/subscription-checker/backend/.env
```

Zawartość:
```env
DATABASE_URL=postgresql://asd:zmien_to_haslo_na_silne@localhost:5432/abonaments
```

```bash
# Zabezpiecz plik (tylko właściciel może czytać)
sudo chown abonaments:abonaments /opt/abonaments/subscription-checker/backend/.env
sudo chmod 600 /opt/abonaments/subscription-checker/backend/.env
```

### 4.7 Firewall (ufw)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## 5. Konfiguracja zmiennych środowiskowych

Jedyna wymagana zmienna środowiskowa to `DATABASE_URL` w pliku `backend/.env`.

Format:
```
DATABASE_URL=postgresql://UŻYTKOWNIK:HASŁO@HOST:PORT/NAZWA_BAZY
```

| Fragment          | Wartość domyślna (dev) | Wartość produkcyjna          |
|-------------------|------------------------|------------------------------|
| UŻYTKOWNIK        | `asd`                  | `asd` (lub dowolna)          |
| HASŁO             | `asd_dev_pass`         | **zmień na silne hasło!**    |
| HOST              | `localhost`            | `localhost`                  |
| PORT              | `5432`                 | `5432`                       |
| NAZWA_BAZY        | `abonaments`           | `abonaments`                 |

---

## 6. Konfiguracja nginx

### 6.1 Plik konfiguracyjny nginx

```bash
sudo nano /etc/nginx/sites-available/abonaments
```

```nginx
server {
    listen 80;
    server_name TWOJA_DOMENA_LUB_IP;

    # ── Frontend (statyczny plik HTML) ────────────────────────────
    root /opt/abonaments/subscription-checker;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # ── Backend API (proxy do FastAPI) ─────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:8001/;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # Duże limity dla uploadu plików Excel/ODS
        client_max_body_size 50M;
        proxy_read_timeout   120s;
        proxy_connect_timeout 10s;
    }

    # ── Logi ───────────────────────────────────────────────────────
    access_log /var/log/nginx/abonaments_access.log;
    error_log  /var/log/nginx/abonaments_error.log;
}
```

```bash
# Aktywuj konfigurację
sudo ln -s /etc/nginx/sites-available/abonaments /etc/nginx/sites-enabled/
sudo nginx -t           # sprawdź składnię
sudo systemctl reload nginx
```

### 6.2 Dostosowanie `const API` w index.html

> **Ważne:** W pliku `index.html` jest linia:
> ```javascript
> const API = 'http://localhost:8001';
> ```
> Przy wdrożeniu przez nginx (proxy `/api/`) zmień ją na:
> ```javascript
> const API = '/api';
> ```
> Dzięki temu frontend będzie korzystać z proxy nginx zamiast łączyć się bezpośrednio z backendem.

```bash
sed -i "s|const API = 'http://localhost:8001'|const API = '/api'|g" \
    /opt/abonaments/subscription-checker/index.html
```

### 6.3 SSL (HTTPS) przez Certbot — opcjonalnie

```bash
sudo apt install -y certbot python3-certbot-nginx

# Pobierz certyfikat (wymaga domeny DNS wskazującej na serwer)
sudo certbot --nginx -d twoja-domena.pl

# Auto-odnowienie (sprawdź czy działa)
sudo certbot renew --dry-run
```

---

## 7. Systemd — backend jako usługa

### 7.1 Plik usługi

```bash
sudo nano /etc/systemd/system/abonaments-backend.service
```

```ini
[Unit]
Description=Weryfikator Abonamentów — FastAPI Backend
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=abonaments
Group=abonaments
WorkingDirectory=/opt/abonaments/subscription-checker/backend

# Zmienne środowiskowe z pliku .env
EnvironmentFile=/opt/abonaments/subscription-checker/backend/.env

# Uruchom Uvicorn z 2 workerami
ExecStart=/opt/abonaments/subscription-checker/backend/venv/bin/uvicorn \
    main:app \
    --host 127.0.0.1 \
    --port 8001 \
    --workers 2 \
    --log-level info

# Restart przy awarii
Restart=on-failure
RestartSec=5s

# Bezpieczeństwo
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/opt/abonaments
ProtectHome=yes

# Logi
StandardOutput=journal
StandardError=journal
SyslogIdentifier=abonaments-backend

[Install]
WantedBy=multi-user.target
```

### 7.2 Uruchomienie usługi

```bash
sudo systemctl daemon-reload
sudo systemctl enable abonaments-backend
sudo systemctl start abonaments-backend

# Sprawdź status
sudo systemctl status abonaments-backend

# Podgląd logów na żywo
sudo journalctl -u abonaments-backend -f
```

### 7.3 Przydatne komendy zarządzania

```bash
# Restart po aktualizacji kodu
sudo systemctl restart abonaments-backend

# Zatrzymanie
sudo systemctl stop abonaments-backend

# Sprawdź ostatnie 50 linii logów
sudo journalctl -u abonaments-backend -n 50 --no-pager
```

---

## 8. Backup bazy danych

### 8.1 Ręczny backup

```bash
# Dump całej bazy
sudo -u postgres pg_dump abonaments > /opt/abonaments/backup_$(date +%Y%m%d_%H%M%S).sql

# Skompresowany
sudo -u postgres pg_dump abonaments | gzip > /opt/abonaments/backup_$(date +%Y%m%d).sql.gz
```

### 8.2 Przywracanie z backupu

```bash
# Przywróć z pliku .sql
sudo -u postgres psql abonaments < backup_20260101_120000.sql

# Przywróć z .sql.gz
gunzip -c backup_20260101.sql.gz | sudo -u postgres psql abonaments
```

### 8.3 Automatyczny backup (cron)

```bash
sudo crontab -e
```

Dodaj (backup codziennie o 2:00 w nocy, przechowuj 30 dni):
```cron
0 2 * * * sudo -u postgres pg_dump abonaments | gzip > /opt/abonaments/backups/backup_$(date +\%Y\%m\%d).sql.gz && find /opt/abonaments/backups/ -name "*.sql.gz" -mtime +30 -delete
```

```bash
sudo mkdir -p /opt/abonaments/backups
sudo chown postgres:postgres /opt/abonaments/backups
```

---

## 9. Aktualizacja aplikacji

### Aktualizacja frontendu (index.html)

```bash
# Skopiuj nowy plik
scp index.html user@SERWER:/opt/abonaments/subscription-checker/

# Jeśli zmieniłeś API URL na /api — upewnij się, że jest nadal ustawione
grep "const API" /opt/abonaments/subscription-checker/index.html
```

Zmiany frontendowe działają **natychmiast** — nginx serwuje plik statyczny, nie trzeba restartować żadnej usługi.

### Aktualizacja backendu (main.py / database.py)

```bash
# Skopiuj nowe pliki
scp backend/main.py backend/database.py user@SERWER:/opt/abonaments/subscription-checker/backend/

# Restart usługi
sudo systemctl restart abonaments-backend

# Sprawdź czy wystartowało bez błędów
sudo systemctl status abonaments-backend
sudo journalctl -u abonaments-backend -n 30 --no-pager
```

### Aktualizacja zależności Pythona

```bash
cd /opt/abonaments/subscription-checker/backend
source venv/bin/activate
pip install --upgrade -r requirements.txt
deactivate
sudo systemctl restart abonaments-backend
```

---

## 10. Rozwiązywanie problemów

### Backend nie startuje

```bash
sudo journalctl -u abonaments-backend -n 50 --no-pager
```

| Błąd | Przyczyna | Rozwiązanie |
|------|-----------|-------------|
| `connection refused (port 5432)` | PostgreSQL nie działa | `sudo systemctl start postgresql` |
| `password authentication failed` | Złe hasło w .env | Sprawdź `DATABASE_URL` w `backend/.env` |
| `database "abonaments" does not exist` | Baza nie istnieje | Utwórz ją (`CREATE DATABASE abonaments`) |
| `ModuleNotFoundError` | Brak pakietu Pythona | `pip install -r requirements.txt` w venv |
| `DeadlockDetected` przy starcie | Kilka instancji jednocześnie | Zostaw 1 worker: `--workers 1` |

### nginx zwraca 502 Bad Gateway

Backend nie odpowiada:
```bash
# Sprawdź czy backend działa
curl -s http://127.0.0.1:8001/status

# Sprawdź logi nginx
sudo tail -f /var/log/nginx/abonaments_error.log
```

### Sprawdzenie połączeń sieciowych

```bash
# Czy backend słucha na porcie 8001?
ss -tlnp | grep 8001

# Czy PostgreSQL słucha na 5432?
ss -tlnp | grep 5432
```

### Resetowanie całej bazy (UWAGA: kasuje dane!)

```bash
sudo -u postgres psql -c "DROP DATABASE abonaments;"
sudo -u postgres psql -c "CREATE DATABASE abonaments OWNER asd;"
sudo systemctl restart abonaments-backend   # init_db() odtworzy tabele
```

---

## Podsumowanie — minimalna lista kontrolna przed uruchomieniem

- [ ] Debian 12 zaktualizowany (`apt update && apt upgrade`)
- [ ] Zainstalowany PostgreSQL, nginx, Python 3.11
- [ ] Baza `abonaments` i użytkownik `asd` utworzeni w PostgreSQL
- [ ] Pliki aplikacji w `/opt/abonaments/subscription-checker/`
- [ ] `backend/.env` z poprawnym `DATABASE_URL` (silne hasło!)
- [ ] Virtualenv `venv` z zainstalowanymi zależnościami
- [ ] Usługa systemd `abonaments-backend` działa (`systemctl status`)
- [ ] nginx skonfigurowany i przeładowany (`nginx -t && systemctl reload nginx`)
- [ ] `const API` w `index.html` zmienione na `/api`
- [ ] Firewall `ufw` aktywny (tylko porty 22, 80, 443)
- [ ] Testowe połączenie z przeglądarki — otwiera się aplikacja, `/status` zwraca dane
