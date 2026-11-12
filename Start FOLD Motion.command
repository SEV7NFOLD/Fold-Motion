#!/bin/bash
# Double-click to start the FOLD Motion studio on this Mac.
cd "$(dirname "$0")" || exit 1
# Double-clicked files don't get the shell's PATH: look where Node.js usually lives.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org, then double-click this file again."
  open https://nodejs.org
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
node scripts/launch-studio.mjs
status=$?
if [ $status -ne 0 ]; then read -n 1 -s -r -p "Press any key to close."; fi
exit $status
