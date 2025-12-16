#!/bin/bash
set -e

# Script to download and setup the CCScript compiler for conformance testing
# Downloads ccscript1337.zip from starmen.net and extracts it

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CCSCRIPT_DIR="$PROJECT_ROOT/ccscript-compiler"
CCSCRIPT_ZIP="$CCSCRIPT_DIR/ccscript1337.zip"
CCSCRIPT_URL="https://starmen.net/pkhack/ccscript/download/ccscript1337.zip"

echo "Setting up CCScript compiler for conformance testing..."

# Create directory if it doesn't exist
mkdir -p "$CCSCRIPT_DIR"

# Download if not already present
if [ ! -f "$CCSCRIPT_ZIP" ]; then
    echo "Downloading CCScript compiler from $CCSCRIPT_URL..."
    curl -L -o "$CCSCRIPT_ZIP" "$CCSCRIPT_URL"
    echo "Download complete."
else
    echo "CCScript compiler archive already downloaded."
fi

# Extract the zip file
echo "Extracting CCScript compiler..."
unzip -q -o "$CCSCRIPT_ZIP" -d "$CCSCRIPT_DIR"
echo "Extraction complete."

# List contents
echo ""
echo "CCScript compiler installed at: $CCSCRIPT_DIR"
echo "Contents:"
ls -lh "$CCSCRIPT_DIR"

# Check for documentation or examples
if [ -d "$CCSCRIPT_DIR/examples" ]; then
    echo ""
    echo "Found examples directory:"
    ls "$CCSCRIPT_DIR/examples"
fi

if [ -f "$CCSCRIPT_DIR/readme.txt" ] || [ -f "$CCSCRIPT_DIR/README.txt" ]; then
    echo ""
    echo "Found README file(s)"
fi

echo ""
echo "Setup complete! The ccscript-compiler directory is git-ignored."
echo "You can now use the CCScript compiler for conformance testing."
