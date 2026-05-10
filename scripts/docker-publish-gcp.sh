#!/usr/bin/env bash
# Build the static UI image and push to Google Artifact Registry.
# Prereqs: Docker running, gcloud CLI, and:
#   gcloud auth configure-docker ${REGION}-docker.pkg.dev
#
# Registry console (this repo):
#   https://console.cloud.google.com/artifacts/docker/inkflow-1/northamerica-northeast2/inkflow/inkflow?project=inkflow-1
#
# Usage:
#   ./scripts/docker-publish-gcp.sh              # tags: git short SHA + latest
#   ./scripts/docker-publish-gcp.sh v1.2.3       # tags: v1.2.3 + latest
#   DOCKER_PLATFORM=linux/arm64 ./scripts/docker-publish-gcp.sh  # override platform (default: linux/amd64)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION="${GCP_REGION:-northamerica-northeast2}"
PROJECT="${GCP_PROJECT:-inkflow-1}"
REPO="${GCP_ARTIFACT_REPO:-inkflow}"
IMAGE_NAME="${GCP_IMAGE_NAME:-inkflow}"

TAG="${1:-$(git rev-parse --short HEAD)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${IMAGE_NAME}"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — set REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY, REACT_APP_STRIPE_PUBLISHABLE_KEY" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "./.env.local"
set +a

: "${REACT_APP_SUPABASE_URL:?}"
: "${REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY:?}"
: "${REACT_APP_STRIPE_PUBLISHABLE_KEY:?}"

PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"

echo "Building ${IMAGE}:${TAG} (+ latest) for platform ${PLATFORM}"
docker build \
  --platform "${PLATFORM}" \
  --build-arg REACT_APP_SUPABASE_URL="${REACT_APP_SUPABASE_URL}" \
  --build-arg REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY="${REACT_APP_SUPABASE_PUBLISHABLE_DEFAULT_KEY}" \
  --build-arg REACT_APP_STRIPE_PUBLISHABLE_KEY="${REACT_APP_STRIPE_PUBLISHABLE_KEY}" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  .

echo "Pushing ${IMAGE}:${TAG} and ${IMAGE}:latest"
docker push "${IMAGE}:${TAG}"
docker push "${IMAGE}:latest"

echo "Done."
