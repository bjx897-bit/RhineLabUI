import fs from "node:fs/promises";

const requiredFields = [
  "id",
  "title",
  "en",
  "category",
  "name",
  "major",
  "school",
  "targetRole",
];
const isText = (value) => typeof value === "string" && value.trim().length > 0;

export function validateContent(content) {
  const errors = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("档案数据必须是 JSON 对象。");
  }
  for (const key of ["categories", "columns"]) {
    const names = content[key];
    if (!Array.isArray(names) || names.length === 0 || !names.every(isText)) {
      errors.push(key + "：必须包含至少一个非空分类名称");
    } else if (
      new Set(names).size !== names.length ||
      names.includes("全部档案")
    ) {
      errors.push(key + "：分类名称不能重复，也不能使用“全部档案”");
    }
  }
  const categories = Array.isArray(content.categories)
    ? content.categories
    : [];
  const columns = Array.isArray(content.columns) ? content.columns : [];
  if (
    categories.some((name) => !columns.includes(name)) ||
    columns.some((name) => !categories.includes(name))
  ) {
    errors.push("categories 与 columns 必须包含相同的分类（顺序可以不同）");
  }
  const records = Array.isArray(content.records) ? content.records : [];
  if (records.length === 0) errors.push("records：必须包含至少一份档案");
  const ids = new Set();
  records.forEach((record, index) => {
    const label = "records[" + index + "]";
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(label + "：必须是档案对象");
      return;
    }
    for (const key of requiredFields) {
      if (!isText(record[key]))
        errors.push(label + "." + key + "：必须是非空文本");
    }
    if (!/^X-\d{3}$/.test(record.id) || record.id === "X-000")
      errors.push(label + ".id：编号格式必须为 X-001 至 X-999");
    if (ids.has(record.id)) errors.push(label + ".id：重复编号 " + record.id);
    ids.add(record.id);
    if (!categories.includes(record.category))
      errors.push(label + ".category：未知分类 " + record.category);
  });
  for (const name of columns) {
    if (!records.some((record) => record?.category === name)) {
      errors.push("分类“" + name + "”：必须包含至少一份档案");
    }
  }
  if (errors.length)
    throw new Error("档案数据校验失败：\n- " + errors.join("\n- "));
  return content;
}

export async function loadContent() {
  return validateContent(
    JSON.parse(
      await fs.readFile(
        new URL("../content/archives.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}

export function archiveText(r) {
  return [
    "\uFEFF" + r.title,
    r.en,
    "FILE " + r.id + " / " + r.category,
    "",
    "姓名：" + r.name,
    "专业：" + r.major,
    "学校：" + r.school,
    "意向岗位：" + r.targetRole,
    "",
  ].join("\n");
}
