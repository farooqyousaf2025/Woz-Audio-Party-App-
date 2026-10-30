const schema = require("./schema.json");

const byClassName = new Map(schema.models.map((model) => [model.className, model]));

function getModel(className) {
  return byClassName.get(className);
}

function quote(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

module.exports = { schema, byClassName, getModel, quote };
