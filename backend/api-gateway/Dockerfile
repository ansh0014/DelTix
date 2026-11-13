# =============================================================================
# DELTIX — API Gateway Dockerfile (:8080)
# Multi-stage optimized build: ~20MB static binary
# =============================================================================

# --- Stage 1: Build static binary ---
FROM golang:1.24-alpine AS builder

WORKDIR /src

RUN apk add --no-cache ca-certificates

ENV GOPROXY=https://goproxy.io,https://proxy.golang.org,direct

# Cache dependencies
COPY backend/shared/go.mod backend/shared/go.sum ./backend/shared/
COPY backend/api-gateway/go.mod backend/api-gateway/go.sum ./backend/api-gateway/
WORKDIR /src/backend/api-gateway
RUN go mod download || (sleep 2 && go mod download)

# Copy source
WORKDIR /src
COPY backend/shared/ ./backend/shared/
COPY backend/api-gateway/ ./backend/api-gateway/

WORKDIR /src/backend/api-gateway
RUN CGO_ENABLED=0 GOOS=linux go build -mod=readonly -trimpath -ldflags="-s -w" -o /bin/api-gateway ./cmd/main.go

# --- Stage 2: Minimal scratch/alpine runtime ---
FROM alpine:3.20 AS runner

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S deltix && adduser -S deltix -G deltix

USER deltix

COPY --from=builder /bin/api-gateway /bin/api-gateway

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/healthz || exit 1

ENTRYPOINT ["/bin/api-gateway"]
