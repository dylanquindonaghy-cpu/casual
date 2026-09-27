#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "nogit"; exit 0; }
{
  git diff HEAD --binary 2>/dev/null
  git ls-files --others --exclude-standard | grep -v '^\.claude/state/' | sort | xargs -r sha256sum
  git rev-parse HEAD 2>/dev/null
} | sha256sum | cut -c1-16
