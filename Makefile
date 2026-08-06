.PHONY: help install-be install-fe install db-up db-down db-init run-be run-fe dev docker-build-push


help: ## Display this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install-be: ## Install backend dependencies
	cd backend && go mod tidy

install-fe: ## Install frontend dependencies
	cd frontend && npm install

install: install-be install-fe ## Install all dependencies

db-up: ## Start PostgreSQL database in Docker
	cd docker && docker-compose up -d

db-down: ## Stop PostgreSQL database
	cd docker && docker-compose down

db-init: ## Re-initialize database (clear all data)
	@CONTAINER=$$(docker ps --filter "publish=5432" --format "{{.Names}}" | head -n 1); \
	if [ -z "$$CONTAINER" ]; then \
		echo "No running container found on port 5432. Using csm-db as fallback."; \
		CONTAINER="csm-db"; \
	fi; \
	echo "Initializing database in container: $$CONTAINER"; \
	docker exec -i $$CONTAINER psql -U root -d csm_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

db-init2: ## Re-initialize database (clear all data)
	@CONTAINER=$$(docker ps --filter "publish=5432" --format "{{.Names}}" | head -n 1); \
	if [ -z "$$CONTAINER" ]; then \
		echo "No running container found on port 5432. Using csm-db as fallback."; \
		CONTAINER="csm-db"; \
	fi; \
	echo "Initializing database in container: $$CONTAINER"; \
	docker exec -i $$CONTAINER psql -U csm_user -d csm_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"



run-be: ## Run backend server
# 	@PID=$$(lsof -t -i:8080); if [ -n "$$PID" ]; then kill -9 $$PID; fi
	cd backend && go run cmd/server/main.go

run-fe: ## Run frontend development server
	@PID=$$(lsof -t -i:5173); if [ -n "$$PID" ]; then kill -9 $$PID; fi
	cd frontend && npm run dev

dev: ## Run both BE and FE (requires manual control or background execution)
	@echo "Starting development environment..."
	@make -j 2 run-be run-fe

docker-build-push: ## Build and push docker images for EC2 (linux/amd64)
	docker buildx build --platform linux/amd64 -t deeair/execute-command-orchestrator:latest --push .
# 	docker buildx build --platform linux/amd64 -t deeair/execute-command-agent:latest -f Dockerfile.agent --push .

docker-push-readme: ## Push docs/DOCKERHUB.md as the Docker Hub repository overview
	docker run --rm -v $(PWD):/data \
		-e DOCKER_USER -e DOCKER_PASS \
		chko/docker-pushrm --file /data/docs/DOCKERHUB.md \
		docker.io/deeair/execute-command-orchestrator
