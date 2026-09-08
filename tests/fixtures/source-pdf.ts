/** Deterministic one-page PDF: original image plus optional invisible OCR text. */
export function sourcePdf(options: { text?: string; image?: boolean; invisible?: boolean; label?: number; outline?: boolean; secondPageText?: string } = {}): Buffer {
  const text = (options.text ?? 'r = { g G C([o, i], E) : g(o) = o, 9(1) = e }.').replace(/[\\()]/g, '\\$&');
  const commands = `${options.image === false ? '' : 'q 300 0 0 300 0 0 cm /Im1 Do Q\n'}BT /F1 14 Tf ${options.invisible === false ? 0 : 3} Tr 20 240 Td (${text}) Tj ET`;
  const bodies = [
    `<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /D /St ${options.label ?? 4} >>] >> ${options.outline ? '/Outlines 6 0 R' : ''} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`,
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\nABC\nendstream',
    '<< /Type /Outlines /First 7 0 R /Last 7 0 R /Count 1 >>',
    '<< /Title (Chapter 1: Critical points) /Parent 6 0 R /Dest [3 0 R /Fit] >>',
  ];
  if (options.secondPageText !== undefined) {
    const secondCommands = `BT /F1 14 Tf 20 240 Td (${options.secondPageText.replace(/[\\()]/g, '\\$&')}) Tj ET`;
    bodies[1] = '<< /Type /Pages /Kids [3 0 R 8 0 R] /Count 2 >>';
    bodies.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 9 0 R >>');
    bodies.push(`<< /Length ${secondCommands.length} >>\nstream\n${secondCommands}\nendstream`);
  }
  let document = '%PDF-1.4\n';
  const offsets = [0];
  bodies.forEach((body, i) => { offsets.push(Buffer.byteLength(document)); document += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  document += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(document);
}
