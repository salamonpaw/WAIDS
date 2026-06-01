# WAIDS — Instrukcja migracji na adres wewnętrzny

**Aplikacja:** WAIDS (Weryfikator Abonamentów IDS)  
**Serwer:** `192.168.20.244` (devenv-psalamon)  
**Użytkownik systemu:** `psalamon`  
**Obecny dostęp:** `http://192.168.20.244`  
**Docelowy adres:** `http://<NOWY_ADRES>` ← uzupełnić przed wykonaniem

---

## 1. Architektura aplikacji

```
Przeglądarka
     │  HTTP :80
     ▼
  nginx
  ├── / → pliki statyczne z /var/www/waids/  (HTML + CSS + JS)
  └── /api/* → proxy → localhost:8001  (FastAPI w Dockerze)
                              │
                         Docker Compose
                         ├── waids_backend  (FastAPI + Python 3.13)
                         └── waids_db       (PostgreSQL 16)
                                  │
                             /var/lib/docker/volumes/
                             (dane bazy persystentne)
```

**Pliki aplikacji na serwerze:**
| Ścieżka | Zawartość |
|---|---|
| `/var/www/waids/` | Frontend (index.html, css/, js/) |
| `/home/psalamon/apps/WAIDS/` | Kod backendu + docker-compose.yml |
| `/etc/nginx/sites-enabled/waids` | Konfiguracja nginx |
| `/var/lib/docker/volumes/waids_pgdata/` | Dane PostgreSQL |

---

## 2. Co trzeba zmienić

Ponieważ frontend używa **względnych ścieżek** (`/api/...`), żadne pliki statyczne nie wymagają modyfikacji.

Jedyna zmiana: **nginx `server_name`** + ewentualnie wpis DNS.

---

## 3. Kroki migracji

### 3.1 Sprawdź aktualną konfigurację nginx

```bash
cat /etc/nginx/sites-enabled/waids
```

Powinno wyglądać mniej więcej tak:

```nginx
server {
    listen 80;
    server_name 192.168.20.244;
    root /var/www/waids;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:8001/;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 120s;
    }
}
```

### 3.2 Zmień `server_name`

```bash
sudo nano /etc/nginx/sites-enabled/waids
```

Zamień:
```nginx
server_name 192.168.20.244;
```
Na:
```nginx
server_name <NOWY_ADRES> 192.168.20.244;
```

> ℹ️ Zostaw stary IP jako drugi człon — aplikacja będzie dostępna pod oboma adresami w czasie przejścia. Po weryfikacji możesz usunąć stary IP.

### 3.3 Sprawdź i przeładuj nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 3.4 Wpis DNS (jeśli nowy adres to hostname, nie IP)

Na serwerze DNS / w pliku hosts na serwerze dodaj:

```
192.168.20.244   <NOWY_ADRES>
```

Lub przekaż administratorowi DNS że `<NOWY_ADRES>` ma wskazywać na `192.168.20.244`.

---

## 4. Weryfikacja po migracji

```bash
# nginx odpowiada na nowym adresie
curl -I http://<NOWY_ADRES>/
# oczekiwane: HTTP/1.1 200 OK

# API działa
curl -s http://<NOWY_ADRES>/api/version
# oczekiwane: {"version":"1.9.2"}

# Pliki statyczne dostępne
curl -I http://<NOWY_ADRES>/css/main.css
curl -I http://<NOWY_ADRES>/js/app.js
# oczekiwane: HTTP/1.1 200 OK, Content-Type: text/css / application/javascript
```

Otwórz w przeglądarce `http://<NOWY_ADRES>` — aplikacja powinna się zalogować normalnie.

---

## 5. Rollback

Jeśli coś nie działa — przywróć oryginalny `server_name`:

```bash
sudo nano /etc/nginx/sites-enabled/waids
# przywróć: server_name 192.168.20.244;
sudo nginx -t && sudo systemctl reload nginx
```

---

## 6. Dodatkowe informacje

- **Backend nie wymaga zmian** — nasłuchuje wyłącznie na `127.0.0.1:8001` (nie jest wystawiony na zewnątrz)
- **Baza danych** — PostgreSQL działa w Dockerze, dane w named volume (`waids_pgdata`), persystentne przez restarty
- **JWT** — klucz sesji przechowywany w bazie, nie w plikach konfiguracyjnych
- **Restart backendu** (gdyby był potrzebny):
  ```bash
  cd /home/psalamon/apps/WAIDS
  docker compose restart backend
  ```
- **Logi backendu:**
  ```bash
  cd /home/psalamon/apps/WAIDS
  docker compose logs backend --tail=50
  ```
- **Logi nginx:**
  ```bash
  sudo tail -50 /var/log/nginx/error.log
  sudo tail -50 /var/log/nginx/access.log
  ```

---

## 7. Kontakt

W razie problemów: Paweł Salamon (właściciel aplikacji)
