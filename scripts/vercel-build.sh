#!/usr/bin/env bash
# Vercel build: build all packages, then assemble the static site in public/.
# Referenced from vercel.json (buildCommand has a 256-char limit).
set -euo pipefail

pnpm -r build

mkdir -p public
cp index.html favicon.svg og-image.png og-image.svg robots.txt sitemap.xml install.sh llms.txt public/
cp legal/*.html pages/*.html public/
mkdir -p public/fonts
cp fonts/*.woff2 public/fonts/
mkdir -p public/.well-known
cp legal/security.txt public/.well-known/security.txt
cp demo/keyline-demo.mp4 public/demo.mp4
cp demo/keyline-demo.webm public/demo.webm
cp -r apps/web/dist public/app
