const fs = require("fs");
const path = require("path");

const modelsDir = process.env.MODELS_DIR
  ? path.resolve(process.env.MODELS_DIR)
  : path.join(__dirname, "..", "..", "woz_audio_party_app", "lib", "models");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const models = [];

for (const file of walk(modelsDir).filter((f) => f.endsWith(".dart"))) {
  const source = fs.readFileSync(file, "utf8");
  const tableMatch = source.match(/keyTableName\s*=\s*"([^"]+)"/);
  const isUser = /extends\s+ParseUser/.test(source);
  if (!tableMatch && !isUser) continue;

  const fields = new Set();
  const fieldPattern = /static\s+(?:final\s+|const\s+)?String\s+key\w*\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = fieldPattern.exec(source)) !== null) {
    if (!match[1].includes(".")) fields.add(match[1]);
  }

  models.push({
    className: tableMatch ? tableMatch[1] : "_User",
    table: tableMatch ? tableMatch[1] : "users",
    dartFile: path.relative(modelsDir, file).replace(/\\/g, "/"),
    fields: [...fields].sort(),
  });
}

models.sort((a, b) => a.className.localeCompare(b.className));

const out = {
  generatedAt: new Date().toISOString(),
  source: modelsDir,
  models,
};

fs.writeFileSync(path.join(__dirname, "..", "src", "schema.json"), JSON.stringify(out, null, 2));
console.log(`Generated schema for ${models.length} models from ${modelsDir}`);
for (const model of models) {
  console.log(`  ${model.className} (${model.fields.length} fields) <- ${model.dartFile}`);
}
