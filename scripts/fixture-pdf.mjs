/** Original, reproducible local PDF for desktop validation. No external materials. */
export function fixturePdf({pages=13,printedStart=4,ocr=false}={}){
 const objects=[];const add=body=>(objects.push(body),objects.length);const catalog=add('');const tree=add('');const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');const symbol=add('<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>');
 const image=add('<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3 >>\nstream\nABC\nendstream');const kids=[];
 for(let index=0;index<pages;index++){
  const pageNumber=index+1;
  const lines=[`Reclimb original desktop fixture - page ${pageNumber}`,'A state u is mapped to an energy J(u).','A path g maps an interval to states in E.','First find the highest energy along each path.','Then compare those highest energies.','This authored sample checks software behavior only.'];
  let content='0.96 0.97 0.93 rg 0 0 600 800 re f\n0.15 0.25 0.18 rg\n';
  if(ocr)content+='q 600 0 0 800 0 0 cm /Im1 Do Q\n';
  content+=`BT /F1 17 Tf ${ocr?3:0} Tr 42 732 Td `+lines.map((line,i)=>(i?'0 -34 Td ':'')+'('+line.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+' ET\n';
  content+='0.18 0.32 0.23 RG 1.5 w 40 490 m 560 490 l S\n';
  content+='BT /F2 20 Tf 0 Tr 42 445 Td (G) Tj /F1 15 Tf 24 0 Td (= { g in C([0,1], E) : g(0) = 0, g(1) = e }) Tj ET\n';
  content+='BT /F1 15 Tf 42 400 Td (c = inf_g max_t J(g(t))) Tj ET\n';
  content+='BT /F1 13 Tf 42 340 Td (The original page stays unchanged when a transcription is confirmed.) Tj ET\n';
  const stream=add('<< /Length '+Buffer.byteLength(content)+' >>\nstream\n'+content+'endstream');
  kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${font} 0 R /F2 ${symbol} 0 R >> /XObject << /Im1 ${image} 0 R >> >> /Contents ${stream} 0 R >>`));
 }
 objects[catalog-1]=`<< /Type /Catalog /Pages ${tree} 0 R /PageLabels << /Nums [0 << /S /D /St ${pages===1?printedStart:1} >> ${pages>1?`${pages-1} << /S /D /St ${printedStart} >>`:''}] >> >>`;
 objects[tree-1]=`<< /Type /Pages /Kids [${kids.map(id=>id+' 0 R').join(' ')}] /Count ${pages} >>`;
 let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((body,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${body}\nendobj\n`});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer << /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(pdf);
}
