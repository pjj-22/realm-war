#!/bin/bash
docker compose pull
docker compose up -d --force-recreate
docker images ghcr.io/pjj-22/realm-war/frontend:latest --digests --format "{{.Digest}}"
