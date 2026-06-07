# DB Info (Postgresql 17)
- USERNAME: user
- PASSWORD: passwd2026
- DB NAME : tara_db

# DB Start
```bash
cd db
docker-compose up -d
```

# DB Dump
```bash
docker exec -it tara-pg17 bash
pg_dump -U user -h localhost -Fc -f tara_db.dump tara_db
```