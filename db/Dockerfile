FROM postgres:18.6

LABEL org.opencontainers.image.title="AutoTARA PostgreSQL" \
      org.opencontainers.image.description="PostgreSQL 18.6 with the AutoTARA CSV catalog"

COPY data/ /opt/autotara/data/
COPY sql/ /opt/autotara/sql/
COPY --chmod=0755 scripts/init-db.sh /docker-entrypoint-initdb.d/10-autotara.sh

WORKDIR /opt/autotara/data
