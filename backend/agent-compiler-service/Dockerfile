# =============================================================================
# DELTIX — Agent Compiler Service Dockerfile (:8081)
# Multi-stage optimized build: ~20MB static binary
# =============================================================================

# --- Stage 1: Build static binary ---
FROM golang:1.24-alpine AS builder

WORKDIR /src

RUN apk add --no-cache ca-certificates

ENV GOPROXY=https://goproxy.io,https://proxy.golang.org,direct

# Cache dependencies
COPY backend/shared/go.mod backend/shared/go.sum ./backend/shared/
COPY backend/agent-compiler-service/go.mod backend/agent-compiler-service/go.sum ./backend/agent-compiler-service/
WORKDIR /src/backend/agent-compiler-service
RUN go mod download || (sleep 2 && go mod download)

# Copy source
WORKDIR /src
COPY backend/shared/ ./backend/shared/
COPY backend/agent-compiler-service/ ./backend/agent-compiler-service/

WORKDIR /src/backend/agent-compiler-service
RUN CGO_ENABLED=0 GOOS=linux go build -mod=readonly -trimpath -ldflags="-s -w" -o /bin/agent-compiler-service ./cmd/main.go

# --- Stage 2: Minimal runtime ---
FROM alpine:3.20 AS runner

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S deltix && adduser -S deltix -G deltix

USER deltix

COPY --from=builder /bin/agent-compiler-service /bin/agent-compiler-service

EXPOSE 8081

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8081/healthz || exit 1

ENTRYPOINT ["/bin/agent-compiler-service"]
