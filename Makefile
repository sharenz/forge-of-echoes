SHELL := /usr/bin/env bash

-include .env.deploy

export DEPLOY_HOST
export DEPLOY_IP
export APP_DOMAIN
export GAME_DOMAIN

.PHONY: setup-prod deploy prod-status

setup-prod:
	./scripts/setup-production.sh

deploy:
	./scripts/deploy-production.sh

prod-status:
	ssh "$${DEPLOY_HOST:-crafty-prod}" 'sudo -n -u crafty -H sh -lc '\''cd /srv/crafty/current; RELEASE_ID=$$(cat .release-id); export RELEASE_ID; docker compose --project-name crafty-prod --env-file /srv/crafty/shared/.env --file deploy/docker-compose.prod.yml ps'\'''
