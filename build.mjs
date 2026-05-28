import { readFileSync, existsSync } from "fs";

const REQUIRED_FILES = ["main.js", "manifest.json", "styles.css"];
const REQUIRED_MANIFEST_KEYS = ["id", "name", "version", "minAppVersion", "description", "author"];

let passed = true;

// Verify all required files exist
for (const file of REQUIRED_FILES) {
    if (!existsSync(file)) {
        console.error(`✗ Missing required file: ${file}`);
        passed = false;
    } else {
        console.log(`✓ Found: ${file}`);
    }
}

// Verify manifest.json is valid and has required keys
if (existsSync("manifest.json")) {
    try {
        const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
        for (const key of REQUIRED_MANIFEST_KEYS) {
            if (!manifest[key]) {
                console.error(`✗ Manifest missing key: ${key}`);
                passed = false;
            } else {
                console.log(`✓ Manifest has: ${key} = ${manifest[key]}`);
            }
        }

        // Verify version is semver
        if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
            console.error(`✗ Manifest version "${manifest.version}" is not semver (e.g. 1.0.0)`);
            passed = false;
        }

        // Verify id does not contain "obsidian" or "plugin"
        if (manifest.id && (manifest.id.includes("obsidian") || manifest.id.includes("plugin"))) {
            console.error(`✗ Manifest ID "${manifest.id}" contains forbidden word (obsidian/plugin)`);
            passed = false;
        }
    } catch (e) {
        console.error(`✗ Failed to parse manifest.json: ${e.message}`);
        passed = false;
    }
}

// Verify main.js does not use innerHTML
if (existsSync("main.js")) {
    const mainJs = readFileSync("main.js", "utf-8");
    if (mainJs.includes("innerHTML")) {
        console.error("✗ main.js contains innerHTML — use createEl instead");
        passed = false;
    } else {
        console.log("✓ No innerHTML usage in main.js");
    }

    if (/console\.log/.test(mainJs)) {
        console.error("✗ main.js contains console.log — remove before release");
        passed = false;
    } else {
        console.log("✓ No console.log in main.js");
    }
}

// Verify styles.css has no !important
if (existsSync("styles.css")) {
    const css = readFileSync("styles.css", "utf-8");
    if (css.includes("!important")) {
        console.error("✗ styles.css contains !important — use selector specificity instead");
        passed = false;
    } else {
        console.log("✓ No !important in styles.css");
    }
}

if (passed) {
    console.log("\nBuild verification passed — release assets are valid.");
    process.exit(0);
} else {
    console.error("\nBuild verification failed — fix errors above before releasing.");
    process.exit(1);
}
