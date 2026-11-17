import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  loadContent,
  validateContent,
  archiveText,
} from "./archive-content.mjs";
import { exportRecords } from "./export-records.mjs";
import { escapeHtml } from "../src/html.ts";

const content = await loadContent();
const example = {
  categories: ["个人信息"],
  columns: ["个人信息"],
  records: [{ ...content.records[0], id: "X-001", category: "个人信息" }],
};
test("only current archive downloads exist and match shared content with BOM", async () => {
  const directory = new URL("../public/archives/", import.meta.url);
  assert.deepEqual(
    (await readdir(directory))
      .filter((name) => /^RHINE-LAB-X-\d{3}\.txt$/.test(name))
      .sort(),
    content.records.map((record) => "RHINE-LAB-" + record.id + ".txt").sort(),
  );
  for (const record of content.records) {
    assert.equal(
      (
        await readFile(
          new URL("RHINE-LAB-" + record.id + ".txt", directory),
          "utf8",
        )
      ).replace(/\r\n/g, "\n"),
      archiveText(record),
    );
  }
});

test("accepts one personal archive and exports all four fields without legacy sections", () => {
  assert.equal(validateContent(example), example);
  assert.deepEqual(
    Object.keys(example.records[0]).sort(),
    [
      "id",
      "title",
      "en",
      "category",
      "name",
      "major",
      "school",
      "targetRole",
    ].sort(),
  );
  const text = archiveText(example.records[0]);
  for (const label of ["姓名：", "专业：", "学校：", "意向岗位："])
    assert.ok(text.includes(label));
  assert.doesNotMatch(text, /研究记录|访问范围|设定参考|游戏原文/);
});

const invalidCases = [
  [
    "missing title",
    (c) => {
      delete c.records[0].title;
    },
    /records\[0\].title/,
  ],
  [
    "blank name",
    (c) => {
      c.records[0].name = " ";
    },
    /records\[0\].name/,
  ],
  [
    "missing major",
    (c) => {
      delete c.records[0].major;
    },
    /records\[0\].major/,
  ],
  [
    "non-text school",
    (c) => {
      c.records[0].school = 42;
    },
    /records\[0\].school/,
  ],
  [
    "blank target role",
    (c) => {
      c.records[0].targetRole = "";
    },
    /records\[0\].targetRole/,
  ],
  [
    "duplicate ID",
    (c) => {
      c.records.push({ ...c.records[0] });
    },
    /重复编号/,
  ],
  [
    "unsafe ID",
    (c) => {
      c.records[0].id = "../outside";
    },
    /编号格式/,
  ],
  [
    "zero ID",
    (c) => {
      c.records[0].id = "X-000";
    },
    /编号格式/,
  ],
  [
    "unknown category",
    (c) => {
      c.records[0].category = "未知";
    },
    /未知分类/,
  ],
  [
    "empty records",
    (c) => {
      c.records = [];
    },
    /至少一份档案/,
  ],
  [
    "null record",
    (c) => {
      c.records[0] = null;
    },
    /必须是档案对象/,
  ],
  [
    "empty category list",
    (c) => {
      c.categories = [];
    },
    /至少一个非空分类/,
  ],
  [
    "blank category",
    (c) => {
      c.categories[0] = " ";
    },
    /非空分类/,
  ],
  [
    "duplicate categories",
    (c) => {
      c.categories.push(c.categories[0]);
    },
    /不能重复/,
  ],
  [
    "reserved category",
    (c) => {
      c.categories[0] = "全部档案";
    },
    /全部档案/,
  ],
  [
    "mismatched columns",
    (c) => {
      c.columns[0] = "其他";
    },
    /相同的分类/,
  ],
  [
    "category without an archive",
    (c) => {
      c.categories.push("新分类");
      c.columns.push("新分类");
    },
    /分类“新分类”：必须包含至少一份档案/,
  ],
];
for (const [name, mutate, error] of invalidCases) {
  test("rejects " + name, () => {
    const invalid = structuredClone(content);
    mutate(invalid);
    assert.throws(() => validateContent(invalid), error);
  });
}
test("accepts different category sizes, independent column order and stable reordered IDs", () => {
  const edited = structuredClone(content);
  edited.categories.push("新分类");
  edited.columns.unshift("新分类");
  edited.records.unshift({
    ...edited.records[0],
    id: "X-007",
    category: "新分类",
  });
  edited.records.push({ ...edited.records[1], id: "X-012" });
  assert.equal(validateContent(edited), edited);
});
test("plain-text punctuation stays literal in HTML and downloadable text", () => {
  const name = "<姓名> & \"示例\" 'A'";
  const edited = structuredClone(content);
  edited.records[0].name = name;
  validateContent(edited);
  assert.equal(
    escapeHtml(name),
    "&lt;姓名&gt; &amp; &quot;示例&quot; &#39;A&#39;",
  );
  assert.ok(archiveText(edited.records[0]).includes(name));
});
test("export cleans only stale generated archives and preserves other files", async () => {
  const output = await mkdtemp(join(tmpdir(), "rhine-archive-export-"));
  try {
    await writeFile(join(output, "RHINE-LAB-X-999.txt"), "stale");
    await writeFile(join(output, "personal-notes.txt"), "keep");
    await writeFile(join(output, "RHINE-LAB-X-999.txt.backup"), "backup");
    await mkdir(join(output, "RHINE-LAB-X-998.txt"));
    assert.equal(await exportRecords(example, output), 1);
    assert.deepEqual((await readdir(output)).sort(), [
      "RHINE-LAB-X-001.txt",
      "RHINE-LAB-X-998.txt",
      "RHINE-LAB-X-999.txt.backup",
      "personal-notes.txt",
    ]);
    assert.equal(
      await readFile(join(output, "personal-notes.txt"), "utf8"),
      "keep",
    );
    assert.equal(
      await readFile(join(output, "RHINE-LAB-X-001.txt"), "utf8"),
      archiveText(example.records[0]),
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
test("invalid input cannot overwrite or remove existing downloads", async () => {
  const output = await mkdtemp(join(tmpdir(), "rhine-invalid-export-"));
  try {
    await writeFile(join(output, "RHINE-LAB-X-001.txt"), "existing");
    await writeFile(join(output, "RHINE-LAB-X-999.txt"), "keep until valid");
    const invalid = structuredClone(content);
    invalid.records[0].name = "";
    await assert.rejects(exportRecords(invalid, output), /records\[0\].name/);
    assert.equal(
      await readFile(join(output, "RHINE-LAB-X-001.txt"), "utf8"),
      "existing",
    );
    assert.equal(
      await readFile(join(output, "RHINE-LAB-X-999.txt"), "utf8"),
      "keep until valid",
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
