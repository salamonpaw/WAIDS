# WAIDS — Weryfikator Abonamentów IDS

WAIDS to aplikacja do weryfikacji abonamentów IDS. Składa się z prostego frontendu HTML/JS, backendu FastAPI oraz bazy danych PostgreSQL.

## Aktualne wdrożenie

Aplikacja działa na firmowej VM z Debianem.

Adres aplikacji:

```text
http://192.168.20.244
```

Aktualny układ:

```text
Użytkownik w sieci firmowej
        ↓
http://192.168.20.244
        ↓
nginx
        ├── frontend: /var/www/waids/index.html
        └── /api → backend Docker: 127.0.0.1:8001
                         ↓
                    PostgreSQL Docker
```

## Stack technologiczny

* Frontend: HTML/CSS/JavaScript, plik `index.html`
* Backend: Python, FastAPI, Uvicorn
* Baza danych: PostgreSQL 16
* Kontenery: Docker Compose
* Reverse proxy / frontend static hosting: nginx
* System: Debian VM

## Struktura projektu

```text
WAIDS/
├── index.html
├── docker-compose.yml
├── update.sh
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── main.py
│   ├── database.py
│   ├── requirements.txt
│   ├── .env.example
│   └── .env
└── DEPLOYMENT.md
```

## Ważne pliki

### `docker-compose.yml`

Uruchamia:

* `waids_db` — PostgreSQL
* `waids_backend` — backend FastAPI

Plik nie powinien zawierać haseł bezpośrednio. Hasła i zmienne środowiskowe są pobierane z pliku `.env`.

### `.env`

Lokalny plik konfiguracyjny dla Docker Compose.

Przykład:

```env
POSTGRES_DB=waids
POSTGRES_USER=waids_user
POSTGRES_PASSWORD=TU_HASLO_DO_BAZY
DATABASE_URL=postgresql://waids_user:TU_HASLO_DO_BAZY@db:5432/waids
```

Ten plik nie jest commitowany do GitHuba.

### `backend/.env`

Plik używany tylko do ręcznych testów backendu poza Dockerem.

Przykład:

```env
DATABASE_URL=postgresql://waids_user:TU_HASLO_DO_BAZY@localhost:5432/waids
```

Ten plik również nie jest commitowany do GitHuba.

### `update.sh`

Skrypt wdrożeniowy używany do aktualizacji aplikacji na VM.

Uruchomienie:

```bash
cd ~/apps/WAIDS
./update.sh
```

Skrypt wykonuje:

1. `git pull`
2. budowę i uruchomienie kontenerów przez Docker Compose
3. skopiowanie `index.html` do `/var/www/waids/index.html`
4. przeładowanie nginx
5. test API `/status`

## Standardowa aktualizacja aplikacji

Po wypchnięciu zmian do GitHuba należy zalogować się na VM i wykonać:

```bash
cd ~/apps/WAIDS
./update.sh
```

Po zakończeniu aplikacja powinna być dostępna pod:

```text
http://192.168.20.244
```

API można sprawdzić komendą:

```bash
curl http://192.168.20.244/api/status
```

Oczekiwany przykładowy wynik:

```json
{"devices":0,"months":[]}
```

## Uruchamianie kontenerów ręcznie

Start / odświeżenie:

```bash
cd ~/apps/WAIDS
docker compose up -d --build
```

Sprawdzenie kontenerów:

```bash
docker ps
```

Oczekiwane kontenery:

```text
waids_db
waids_backend
```

Logi backendu:

```bash
docker logs -f waids_backend
```

Logi bazy:

```bash
docker logs -f waids_db
```

Zatrzymanie aplikacji:

```bash
docker compose down
```

Uwaga: nie używać `docker compose down -v`, jeśli baza zawiera dane produkcyjne, ponieważ `-v` usuwa wolumen z danymi PostgreSQL.

## nginx

Frontend jest serwowany z:

```text
/var/www/waids/index.html
```

Konfiguracja nginx znajduje się w:

```text
/etc/nginx/sites-available/waids
```

Aktywna konfiguracja:

```text
/etc/nginx/sites-enabled/waids
```

Test konfiguracji nginx:

```bash
sudo nginx -t
```

Przeładowanie nginx:

```bash
sudo systemctl reload nginx
```

## Dostęp po IP

Aktualnie aplikacja działa pod adresem:

```text
http://192.168.20.244
```

Docelowo dział IT może przypisać domenę wewnętrzną, np.:

```text
waids.asdsystems.eu
```

Wtedy DNS powinien wskazywać na IP VM:

```text
192.168.20.244
```

Następnie należy zaktualizować `server_name` w konfiguracji nginx.

## Bezpieczeństwo

* PostgreSQL jest wystawiony tylko lokalnie na VM:

```yaml
127.0.0.1:5432:5432
```

* Backend jest wystawiony tylko lokalnie na VM:

```yaml
127.0.0.1:8001:8001
```

* Użytkownicy w sieci firmowej korzystają z aplikacji wyłącznie przez nginx.
* Pliki `.env` nie są commitowane do GitHuba.
* Hasła nie powinny być wpisywane bezpośrednio w `docker-compose.yml`.

## Przydatne komendy diagnostyczne

Status API przez nginx:

```bash
curl http://192.168.20.244/api/status
```

Status API lokalnie:

```bash
curl http://127.0.0.1:8001/status
```

Lista kontenerów:

```bash
docker ps
```

Logi backendu:

```bash
docker logs -f waids_backend
```

Logi nginx:

```bash
sudo tail -n 50 /var/log/nginx/error.log
```

Sprawdzenie portów:

```bash
sudo ss -tlnp | grep -E "80|8001|5432"
```

## Typowy workflow developerski

1. Zmiany w kodzie są robione lokalnie.
2. Zmiany są commitowane i pushowane do GitHuba.
3. Na VM wykonywany jest update:

```bash
cd ~/apps/WAIDS
./update.sh
```

4. Po update należy sprawdzić:

```bash
curl http://192.168.20.244/api/status
```

5. Następnie odświeżyć aplikację w przeglądarce:

```text
http://192.168.20.244
```
