#!/usr/bin/env bash
set -e

log_info() {
    echo -e "\e[33m[INFO]\e[0m $1"
}

log_success() {
    echo -e "\e[32m[SUCCESS]\e[0m $1"
}

log_error() {
    echo -e "\e[31m[ERROR]\e[0m $1"
}

ELECTRON_VERSION="${ELECTRON_VERSION:-v29.1.4}"
NODE_VERSION="${NODE_VERSION:-v20.9.0}"
IS_CROSS_COMPILE="${IS_CROSS_COMPILE:-false}"
RELEASE="${RELEASE:-true}"
TESTING="${TESTING:-false}"
PROPRIETARY_CODECS="${PROPRIETARY_CODECS:-true}"
# https://gn.googlesource.com/gn/+/main/docs/reference.md#var_target_os
TARGET_OS="${TARGET_OS:-linux}"
# https://gn.googlesource.com/gn/+/main/docs/reference.md#var_target_cpu
TARGET_CPU="${TARGET_CPU:-x64}"
RM_PATCH_FILES="${RM_PATCH_FILES:-true}"
export GIT_CACHE_PATH="${GIT_CACHE_PATH:-${HOME}/.git_cache}"
mkdir -p "${GIT_CACHE_PATH}"
DEPOT_TOOLS_PATH="${DEPOT_TOOLS_PATH:-${HOME}/depot_tools}"
export CHROMIUM_BUILDTOOLS_PATH="${CHROMIUM_BUILDTOOLS_PATH:-electron/src/buildtools}"


log_info "Script is really buggy, use at your own risk"
log_info "Installing dependencies"
log_info "Installing script dependencies"
sudo apt install -y curl git

log_info "Installing compilation dependencies"
sudo apt update -y
sudo apt install -y build-essential clang libdbus-1-dev libgtk-3-dev \
                       libnotify-dev libasound2-dev libcap-dev \
                       libcups2-dev libxtst-dev \
                       libxss1 libnss3-dev gcc-multilib g++-multilib curl \
                       gperf bison python3-dbusmock openjdk-8-jre

if [ "$IS_CROSS_COMPILE" = "true" ]; then
    log_info "Installing cross-compilation dependencies"
    sudo apt install -y libc6-dev-armhf-cross linux-libc-dev-armhf-cross \
                        g++-arm-linux-gnueabihf
fi

if [[ "$(node --version)" != "$NODE_VERSION" ]]; then
    if command -v nvm &> /dev/null; then
        log_success "Nvm is already installed"
    else
        log_info "Installing nvm"
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
    fi
    log_info "Installing node version $NODE_VERSION"
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION"
else
    log_success "Node.js $NODE_VERSION is already installed"
fi

if command -v gclient &> /dev/null; then
    log_success "Depot tools is already installed"
else
    chor "Installing depot tools"
    if [ ! -d "$DEPOT_TOOLS_PATH" ]; then
        git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$DEPOT_TOOLS_PATH"
    fi
    export PATH="$DEPOT_TOOLS_PATH:$PATH"
    if ! command -v gclient &> /dev/null; then
        log_error "Failed to install depot tools"
        exit 1
    fi
fi

log_success "Finished installing dependencies"

mkdir -p electron && cd electron
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
mkdir -p src && cd src
log_info "Cloning electron $ELECTRON_VERSION"
git clone --branch "$ELECTRON_VERSION" --depth 1 https://github.com/electron/electron.git
cd electron
log_info "Syncing using gclient, this may take a while\nTake a coffee break"
gclient sync -f


cd ..

if [ "$PROPRIETARY_CODECS" = "true" ]; then
    if [ ! -d "electron-chromium-codecs" ]; then
        echo "Cloning electron-chromium-codecs"
        git clone https://github.com/ThaUnknown/electron-chromium-codecs
    fi
    ELECTRON_VERSION="${ELECTRON_VERSION:-v29.1.4}"

    chromium_patch_name="look_chromium_hevc_ac3.patch"
    ffmpeg_patch_name="look_ffmpeg_hevc_ac3.patch"
    electron_patch_name="look_electron_hevc_ac3.patch"

    chromium_patch_dest="src/$chromium_patch_name"
    electron_patch_dest="src/electron/$electron_patch_name"
    ffmpeg_patch_dest="src/third_party/ffmpeg/$ffmpeg_patch_name"

    cp "electron-chromium-codecs/$ELECTRON_VERSION/$chromium_patch_name" "$chromium_patch_dest"
    cp "electron-chromium-codecs/$ELECTRON_VERSION/$electron_patch_name" "$electron_patch_dest"
    cp "electron-chromium-codecs/$ELECTRON_VERSION/$ffmpeg_patch_name" "$ffmpeg_patch_dest"

    log_info "Applying codec patches"
    git apply "$chromium_patch_dest"
    git apply "$electron_patch_dest"  
    git apply "$ffmpeg_patch_dest"

    if [ "$RM_PATCH_FILES" = "true" ]; then
        rm -rf electron-chromium-codecs
        rm "$chromium_patch_dest"
        rm "$electron_patch_dest"
        rm "$ffmpeg_patch_dest"
    fi
fi

cd src

if [ "$TESTING" = "true" ]; then
    log_info "Building testing electron $ELECTRON_VERSION"
    gn gen out/Testing --args="import(\"//electron/build/args/testing.gn\") target_os=\"$TARGET_OS\" target_cpu=\"$TARGET_CPU\""
    ninja -C out/Testing electron
fi

if [ "$RELEASE" = "true" ]; then
    log_info "Building release electron $ELECTRON_VERSION"
    gn gen out/Release --args="import(\"//electron/build/args/release.gn\") target_os=mac 
    ninja -C out/Release electron
fi

log_success "Finished building electron $ELECTRON_VERSION"