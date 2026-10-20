// Execute the real TypeScript modules with explicit dependency doubles, without
// adding a test runner or sending requests to the application's live database.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");

function loadTs(relativePath, overrides = {}) {
  const cache = new Map();

  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const localRequire = createRequire(filename);
    function requireDependency(specifier) {
      if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const base = specifier.startsWith("@/")
          ? path.join(root, "web-contract", specifier.slice(2))
          : path.resolve(path.dirname(filename), specifier);
        const dependency = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]
          .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (dependency && /\.tsx?$/.test(dependency)) return load(dependency);
        if (dependency) return localRequire(dependency);
      }
      return localRequire(specifier);
    }

    const source = fs.readFileSync(filename, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    const execute = vm.runInThisContext(
      `(function(require, module, exports, __filename, __dirname) {\n${outputText}\n})`,
      { filename },
    );
    execute(requireDependency, loadedModule, loadedModule.exports, filename, path.dirname(filename));
    return loadedModule.exports;
  }

  return load(path.resolve(root, relativePath));
}

module.exports = { loadTs };
