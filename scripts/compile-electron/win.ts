import { execSync } from "child_process";
import { exit } from "process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFile, writeFileSync } from "fs";
import path from "path";

const electronVersion = "v29.1.4";
const nodeVersion = "v20.9.0"
const cacheDir = mkdir(".cache");
const depotDir = path.join(cacheDir, "depot_tools")
const gitCacheDir = mkdir(cacheDir, ".git_cache")
const electronDir = mkdir(cacheDir, "electron")
const electronSrcDir = path.join(electronDir, "src");
const electronSrcElectronDir = path.join(electronSrcDir, "electron");
const codecsRepoDir = path.join(cacheDir, "electron-chromium-codecs")
const codecsPatchDir = path.join(codecsRepoDir, electronVersion);

function logInfo(message: string) {
    console.log(`\x1b[33m[INFO]\x1b[0m ${message}`);
}

function logSuccess(message: string) {
    console.log(`\x1b[32m[SUCCESS]\x1b[0m ${message}`);
}

function logError(message: string) {
    console.log(`\x1b[31m[ERROR]\x1b[0m ${message}`);
}

process.env.GIT_CACHE_PATH = gitCacheDir;
process.env.PATH = `${depotDir};${process.env.PATH}`;
process.env.CHROMIUM_BUILDTOOLS_PATH = path.join(electronSrcDir, "buildtools");
process.env.DEPOT_TOOLS_WIN_TOOLCHAIN = "0";

function isAdmin(): boolean {
    try {
        execSync("net session", { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

function mkdir(...dir: string[]) {
    const newDir = path.resolve(...dir)
    mkdirSync(newDir, { recursive: true })
    return newDir
}

function cd(...dir: string[]) {
    const newDir = path.resolve(cacheDir, ...dir)
    process.chdir(newDir)
}

function installVSIfNotInstalled() {
    const vsWherePath = `${process.env["ProgramFiles(x86)"]}\\Microsoft Visual Studio\\Installer\\vswhere.exe`;
    const command = `"${vsWherePath}" -latest -property installationPath`;
    installIfNotInstalled(command, "Microsoft.VisualStudio.2022.Community",
        (output) => !!output.trim());

}

function extractZip(zipFilePath: string, outputDir: string) {
    mkdir(outputDir);
    logInfo(`Extracting ${zipFilePath} to ${outputDir}`);
    run(`tar -xf "${zipFilePath}" -C "${outputDir}"`);
}

function isInstalled(checkCommand: string, validateOutput?: ((output: string) => boolean)) {
    try {
        const output = run(checkCommand, true);
        if (!validateOutput || validateOutput(output)) {
            return true;
        }
    } catch {
        return false;
    }
}

function installIfNotInstalled(checkCommand: string, wingetId: string, validateOutput?: ((output: string) => boolean)) {
    if (isInstalled(checkCommand, validateOutput)) {
        logInfo(`${wingetId} is already installed`);
        return;
    }
    logInfo(`${wingetId} is NOT installed. Installing...`);
    run(`winget install -e --id ${wingetId}`);
}


function installDepotTools() {
    if (existsSync(depotDir)) {
        logInfo("Depot tools is already installed");
        return
    }
    const depotToolsUrl = "https://storage.googleapis.com/chrome-infra/depot_tools.zip"
    // Fuck it why not
    const depotZipName = depotToolsUrl.split("/").pop()!;
    const depotZipPath = path.join(cacheDir, depotZipName)
    run(`curl ${depotToolsUrl} --output ${depotZipPath}`)
    extractZip(depotZipPath, depotDir)
    rmSync(depotZipPath);
    cmd("gclient");
}

function run(command: string, capture_output = false) {
    logInfo(command);
    return execSync(command, { encoding: "utf-8", stdio: capture_output ? "pipe" : "inherit" });
}

function cmd(command: string) {
    run(`cmd /c ${command}`);
}


function installNode() {
    if (isInstalled("node --version", (output) => output.includes(nodeVersion))) {
        logInfo(`Node.js ${nodeVersion} is already installed`);
        return;
    }
    installIfNotInstalled("nvm --version", "CoreyButler.NVMforWindows");
    run(`nvm install ${nodeVersion}`);
    run(`nvm use ${nodeVersion}`);
}
async function realMain() {
    if (!isAdmin()) {
        logError("You need to run this script as an admin");
        exit(1);
    }
    logInfo("Script is really buggy, use at your own risk");
    installVSIfNotInstalled();
    installIfNotInstalled("git --version", "Git.Git")
    installNode();
    installDepotTools();

    cd(electronDir);
    cmd(`gclient config --name "src/electron" --unmanaged https://github.com/electron/electron`);
    cmd(`git clone https://github.com/electron/electron --depth 1 --branch ${electronVersion} ${electronSrcElectronDir}`);

    cd(electronSrcElectronDir);
    // run("git remote remove origin")
    // run("git remote add origin https://github.com/electron/electron")
    // run("git checkout main")
    // run("git branch --set-upstream-to=origin/main")
    // run(`git checkout ${electronVersion} -f`)
    cmd("gclient sync -f")
    if (!existsSync(codecsRepoDir)) {
        run(`git clone https://github.com/ThaUnknown/electron-chromium-codecs ${codecsRepoDir}`);
    } else {
        logInfo("Codecs repo already cloned. Pulling latest changes...");
        run(`git -C ${codecsRepoDir} pull`);
    }
    const mvFile = (filename: string, srcDir: string, destDir: string) =>
        renameSync(path.join(srcDir, filename), path.join(destDir, filename));
    mvFile("look_chromium_hevc_ac3.patch", codecsPatchDir, electronSrcDir)
    mvFile("look_electron_hevc_ac3.patch", codecsPatchDir, electronSrcElectronDir)
    mvFile("look_ffmpeg_hevc_ac3.patch", codecsPatchDir, path.join(electronSrcDir, "third_party", "ffmpeg"))
    const missingFilePath = path.join(electronSrcDir, "third_party", "ffmpeg", "libavcodec", "autorename_libavcodec_bswapdsp.c");
    const missingFileContent = `#include "bswapdsp.c"`;
    writeFileSync(missingFilePath, missingFileContent, { encoding: 'utf8' });
    const dos2unixExePath = `"${process.env["ProgramFiles"]}\\Git\\usr\\bin\\dos2unix.exe"`;
    run(`${dos2unixExePath} ${path.join(electronSrcElectronDir, "shell", "common", "extensions", "api", "resources_private.idl")}`)
    run(`${dos2unixExePath} ${path.join(electronSrcElectronDir, "shell", "common", "extensions", "api", "cryptotoken_private.idl")}`)
    run(`${dos2unixExePath} ${path.join(electronDir, "src", "chrome", "shell", "common", "extensions", "api", "resources_private.idl")}`)
    run(`${dos2unixExePath} ${path.join(electronDir, "src", "chrome", "shell", "common", "extensions", "api", "cryptotoken_private.idl")}`)

    cd(electronSrcDir)
    run("git apply look_chromium_hevc_ac3.patch")
    cd(electronSrcElectronDir)
    run("git apply look_electron_hevc_ac3.patch")
    cd(path.join(electronSrcDir, "third_party", "ffmpeg"))
    run("git apply look_ffmpeg_hevc_ac3.patch")

    cd(electronSrcDir)
    cmd(`gn gen out/Release --args="import(\\\"//electron/build/args/release.gn\\\")"`);

    cmd("ninja -C out/Release electron")
}

async function main() {
    try {
        await realMain();
    } catch (error) {
        try {
            if (isInstalled("nvm --version")) {
                logInfo("Fatal Error encountered, reverting node version before exiting...");
                run(`nvm use ${process.version}`);
            }
        } catch (error) {
            logError(`Failed to revert node version: ${error}`);
        }
        logError(`Fatal Error: ${error}`);
        exit(1);
    }
}

await main();