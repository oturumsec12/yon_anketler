// Harici Excel kutuphanesi kullanmadan gecerli XLSX (OOXML) olusturur.
// Hucreler inline string oldugundan '=' ile baslayan icerik formule donusmez.

const textEncoder = new TextEncoder();

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function columnName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipUncompressed(files) {
  const localParts = [];
  const centralParts = [];
  let currentOffset = 0;
  let centralSize = 0;

  for (const [filename, content] of files) {
    const nameBytes = textEncoder.encode(filename);
    const data = textEncoder.encode(content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lh = new DataView(local.buffer);
    lh.setUint32(0, 0x04034B50, true);
    lh.setUint16(4, 20, true); // version needed
    lh.setUint16(6, 0, true);  // flags
    lh.setUint16(8, 0, true);  // stored, no compression
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const ch = new DataView(central.buffer);
    ch.setUint32(0, 0x02014B50, true);
    ch.setUint16(4, 20, true); // made by
    ch.setUint16(6, 20, true); // version needed
    ch.setUint16(8, 0, true);
    ch.setUint16(10, 0, true); // no compression
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, currentOffset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    centralSize += central.length;
    currentOffset += local.length + data.length;
  }

  const end = new Uint8Array(22);
  const eh = new DataView(end.buffer);
  eh.setUint32(0, 0x06054B50, true);
  eh.setUint16(8, files.length, true);
  eh.setUint16(10, files.length, true);
  eh.setUint32(12, centralSize, true);
  eh.setUint32(16, currentOffset, true);

  return new Blob([...localParts, ...centralParts, end], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function createXlsx(headers, rows) {
  const all = [headers, ...rows];
  const sheetRows = all.map((row, i) => {
    const cells = row.map((value, j) => {
      const ref = `${columnName(j)}${i + 1}`;
      const text = xmlEscape(value);
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
    }).join("");
    return `<row r="${i + 1}">${cells}</row>`;
  }).join("");

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${sheetRows}</sheetData></worksheet>`;

  return zipUncompressed([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
      ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Anket Sonuçları" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`],
    ["xl/worksheets/sheet1.xml", sheet],
  ]);
}
