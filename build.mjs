import { readFileSync, existsSync } from "node:fs";

const REQUIRED_FILES = ["main.js", "manifest.json", "styles.css"];
const REQUIRED_MANIFEST_KEYS = ["id", "name", "version", "minAppVersion", "description", "author"];

let passed = true;

// Verify all required files exist
for (const file of REQUIRED_FILES) {
    if (!existsSync(file)) {
        console.error(`[FAIL] Missing required file: ${file}`);
        passed = false;
    } else {
        console.log(`[PASS] Found: ${file}`);
    }
}

// Verify manifest.json is valid and has required keys
if (existsSync("manifest.json")) {
    try {
        const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
        for (const key of REQUIRED_MANIFEST_KEYS) {
            if (!manifest[key]) {
                console.error(`[FAIL] Manifest missing key: ${key}`);
                passed = false;
            } else {
                console.log(`[PASS] Manifest has: ${key} = ${manifest[key]}`);
            }
        }

        // Verify version is semver
        if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
            console.error(`[FAIL] Manifest version "${manifest.version}" is not semver (e.g. 1.0.0)`);
            passed = false;
        }

        // Verify id does not contain "obsidian" or "plugin"
        if (manifest.id && (manifest.id.includes("obsidian") || manifest.id.includes("plugin"))) {
            console.error(`[FAIL] Manifest ID "${manifest.id}" contains forbidden word (obsidian/plugin)`);
            passed = false;
        }
    } catch (e) {
        console.error(`[FAIL] Failed to parse manifest.json: ${e.message}`);
        passed = false;
    }
}

// Verify main.js does not use innerHTML
if (existsSync("main.js")) {
    const mainJs = readFileSync("main.js", "utf-8");
    if (mainJs.includes("innerHTML")) {
        console.error("[FAIL] main.js contains innerHTML -- use createEl instead");
        passed = false;
    } else {
        console.log("[PASS] No innerHTML usage in main.js");
    }

    if (/console\.(log|debug|info|trace)/.test(mainJs)) {
        console.error("[FAIL] main.js contains console.log/debug/info/trace -- remove before release");
        passed = false;
    } else {
        console.log("[PASS] No debug console calls in main.js");
    }
}

// Verify styles.css has no !important
if (existsSync("styles.css")) {
    const css = readFileSync("styles.css", "utf-8");
    if (css.includes("!important")) {
        console.error("[FAIL] styles.css contains !important -- use selector specificity instead");
        passed = false;
    } else {
        console.log("[PASS] No !important in styles.css");
    }
}

if (passed) {
    console.log("\nBuild verification passed — release assets are valid.");
    process.exit(0);
} else {
    console.error("\nBuild verification failed — fix errors above before releasing.");
    process.exit(1);
}
