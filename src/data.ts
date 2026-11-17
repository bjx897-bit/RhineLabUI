import content from "../content/archives.json" with { type: "json" };

export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  category: string;
  name: string;
  major: string;
  school: string;
  targetRole: string;
}

export const records: ArchiveRecord[] = content.records;
export const categories = content.categories;
export const archiveColumns = content.columns;
// Content columns are logical indices. The visual pool retains its original
// center column and 32 rows even when the library contains a single record.
export const ARCHIVE_ROWS = 32;
export const ARCHIVE_START_ROW = 12;
export const archiveLaneOffset = 2 - Math.floor((archiveColumns.length - 1) / 2);

export function columnAtLane(lane: number) {
  const count = archiveColumns.length;
  return ((lane - archiveLaneOffset) % count + count) % count;
}

export function columnFiles(lane: number) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.category === archiveColumns[lane])
    .map(({ index }) => index);
}
export function fileLocation(index: number) {
  const lane = archiveColumns.indexOf(records[index].category);
  const row = ARCHIVE_START_ROW + columnFiles(lane).indexOf(index);
  return { lane, row, slot: lane * ARCHIVE_ROWS + row };
}
export function physicalFileLocation(index: number) {
  const location = fileLocation(index);
  const lane = location.lane + archiveLaneOffset;
  return { lane, row: location.row, slot: lane * ARCHIVE_ROWS + location.row };
}
export function fileAtSlot(slot: number) {
  const files = columnFiles(columnAtLane(Math.floor(slot / ARCHIVE_ROWS)));
  const row = ((slot % ARCHIVE_ROWS) + ARCHIVE_ROWS) % ARCHIVE_ROWS;
  return files[Math.max(0, Math.min(files.length - 1, row - ARCHIVE_START_ROW))];
}
