# WAIDS — zmiana adresu dostępu (notatka dev)

**Serwer:** `devenv-psalamon` / `192.168.20.244`  
**Obecny URL:** `http://192.168.20.244`  
**Docelowy URL:** `http://waids.asdsystems.eu`

---

## Stack

```
nginx :80
  /         → /var/www/waids/          (statyczny frontend)
  /api/*    → proxy 127.0.0.1:8001     (FastAPI w Dockerze)

Docker Compose (/home/psalamon/apps/WAIDS/):
  waids_backend   FastAPI + Python 3.13
  waids_db        PostgreSQL 16  (volume: waids_pgdata)
```

Frontend używa wyłącznie względnych ścieżek `/api/…` — żadne pliki JS/HTML nie wymagają zmian przy zmianie adresu.

---

## Co trzeba zrobić

### 1. DNS (dział IT)

Rekord A lub CNAME:
```
waids.asdsystems.eu → 192.168.20.244
```

### 2. nginx `server_name` (dev / admin VM)

Plik: `/etc/nginx/sites-enabled/waids`

```nginx
# było:
server_name 192.168.20.244;

# zmienić na (oba, żeby stary IP działał w czasie przejścia):
server_name waids.asdsystems.eu 192.168.20.244;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Weryfikacja

```bash
curl -s http://waids.asdsystems.eu/api/version   # → {"version":"1.9.x"}
curl -I http://waids.asdsystems.eu/               # → 200 OK
```

---

## Rollback

```bash
# /etc/nginx/sites-enabled/waids → przywrócić: server_name 192.168.20.244;
sudo nginx -t && sudo systemctl reload nginx
```

---

## Notatki

- Backend binduje wyłącznie `127.0.0.1:8001`, nie jest wystawiony na sieć
- JWT secret przechowywany w bazie, nie w plikach konfiguracyjnych — restart nie inwaliduje sesji
- Dane PostgreSQL: named volume `waids_pgdata`, persystentne przez restarty/rebuild
- SSL/HTTPS: na razie poza zakresem; jeśli będzie potrzebny — certbot na nginx lub wewnętrzny CA

```bash
# logi w razie problemów
docker compose -f /home/psalamon/apps/WAIDS/docker-compose.yml logs backend --tail=50
sudo tail -30 /var/log/nginx/error.log
```
